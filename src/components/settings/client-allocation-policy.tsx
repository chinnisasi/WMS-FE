'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { fetchApiUpdateClientAllocationPolicy } from '@/lib/api/client';
import type { ClientAllocationPolicyResponse, ClientDto } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import {
  ALLOCATION_RULES,
  ALLOCATION_RULE_LABEL,
  ALLOCATION_SAVE_EFFECT,
  MIN_OUTBOUND_SHELF_LIFE_DAYS_MAX,
  MIN_OUTBOUND_SHELF_LIFE_DAYS_MIN,
  UNDATED_RULE_NOTE,
  allocationPolicyFieldOf,
  allocationPolicyFieldsOf,
  allocationPolicyReason,
  allocationPolicySaved,
  allocationPolicyWarnings,
  minOutboundShelfLifeLabel,
  parseAllocationPolicyDraft,
  untrackedAllocationNote,
  type AllocationPolicy,
  type AllocationPolicyFields,
} from '@/lib/allocation-policy';
import { ulid } from '@/lib/ulid';
import { useClientAllocationPolicy } from '@/lib/use-client-allocation-policy';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ReadFailure } from '@/components/shared/surface';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring) disabled:opacity-60';
const labelClass = 'text-sm font-medium';
const rowButtonClass =
  'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40';
const primaryButtonClass =
  'rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-40';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/**
 * Story 4-3a — a client's outbound allocation policy: the rule (FEFO / FIFO)
 * and the minimum remaining shelf life at dispatch. Every staff session reads
 * it; an owner (`canManage`, `clients.manage`) edits. The save is a FULL
 * replace of both keys under a per-draft Idempotency-Key (minted on the first
 * submit after the draft parses, reused across retries of the unchanged
 * draft, cleared on success and on any edit). Its notes say what the rule
 * cannot reach (untracked SKUs, undated batches) and what a save does (A13);
 * its warnings never block (A12, A13).
 */
export function ClientAllocationPolicyPanel({
  client,
  canManage,
  onClose,
  onSaved,
  onDirtyChange,
}: {
  client: ClientDto;
  canManage: boolean;
  onClose: () => void;
  onSaved: (client: ClientDto) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const policy = useClientAllocationPolicy(client.id);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-md border border-(--border) p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-medium outline-none">
          Outbound allocation — {client.code}
        </h3>
        <button type="button" onClick={onClose} className={rowButtonClass}>
          Close
        </button>
      </div>

      {policy.state === 'failed' ? (
        <ReadFailure word="Allocation policy unavailable" reason={policy.reason} onRetry={policy.reload} />
      ) : policy.state === 'loading' ? (
        <div className="text-(--muted-foreground)">Loading the allocation policy…</div>
      ) : (
        <PolicyBody client={client} read={policy.data} canManage={canManage} onSaved={onSaved} onDirtyChange={onDirtyChange} />
      )}
    </section>
  );
}

function PolicyBody({
  client,
  read,
  canManage,
  onSaved,
  onDirtyChange,
}: {
  client: ClientDto;
  read: ClientAllocationPolicyResponse;
  canManage: boolean;
  onSaved: (client: ClientDto) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [current, setCurrent] = useState<AllocationPolicy>(read);
  const [fields, setFields] = useState<AllocationPolicyFields>(() => allocationPolicyFieldsOf(read));
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  const edit = (next: AllocationPolicyFields) => {
    keyRef.current = null;
    setFields(next);
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(allocationPolicyFieldsOf(current)));
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseAllocationPolicyDraft(fields);
    if (parsed.body === null) {
      setProblem(parsed.problem);
      return;
    }
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setProblem(null);
    setOutcome(null);
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const saved = await fetchApiUpdateClientAllocationPolicy(session.tenant.id, client.id, parsed.body, keyRef.current);
      keyRef.current = null;
      // The answer's policy when it carries one (a replayed pre-4-3a answer
      // may not), else what this full replace sent.
      const next = saved.allocationPolicy ?? parsed.body;
      setCurrent(next);
      setFields(allocationPolicyFieldsOf(next));
      onDirtyChange(false);
      setOutcome({ tone: 'accepted', ...allocationPolicySaved(client.code) });
      onSaved(saved);
    } catch (error) {
      if (allocationPolicyFieldOf(error) === 'minDays') setProblem(allocationPolicyReason(error));
      else setOutcome({ tone: 'rejected', word: 'Allocation policy not saved', reason: allocationPolicyReason(error) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  // The warnings judge the DRAFT (an owner sees them before saving) or, for a
  // reader, the stored policy.
  const draftMin = canManage ? parseAllocationPolicyDraft(fields).body?.minOutboundShelfLifeDays ?? null : current.minOutboundShelfLifeDays;
  const warnings = allocationPolicyWarnings({
    minDays: draftMin,
    expiryRequired: client.receivingPolicy?.expiryRequired ?? false,
    receivingMinDays: client.receivingPolicy?.minShelfLifeDays ?? null,
    undatedBatchesOnHand: read.undatedBatchesOnHand,
  });

  const notes = (
    <ul className="flex list-disc flex-col gap-0.5 pl-5 text-xs text-(--muted-foreground)">
      <li>{untrackedAllocationNote(read.untrackedSkuCount)}</li>
      <li>{UNDATED_RULE_NOTE}</li>
      <li>{ALLOCATION_SAVE_EFFECT}</li>
    </ul>
  );
  const warningList =
    warnings.length === 0 ? null : (
      <ul aria-label="Allocation policy warnings" className="flex flex-col gap-1">
        {warnings.map((warning) => (
          <li key={warning} role="status" className="rounded-sm border border-(--warning,#b45309) px-2 py-1 text-xs">
            {warning}
          </li>
        ))}
      </ul>
    );

  if (!canManage) {
    return (
      <>
        <dl className="grid gap-1">
          <dt className={labelClass}>Allocation rule</dt>
          <dd>{ALLOCATION_RULE_LABEL[current.allocationRule].label}</dd>
          <dt className={labelClass}>Minimum remaining shelf life at dispatch</dt>
          <dd>{minOutboundShelfLifeLabel(current.minOutboundShelfLifeDays)}</dd>
        </dl>
        {warningList}
        {notes}
      </>
    );
  }

  return (
    <form aria-label={`Allocation policy of ${client.code}`} className="flex flex-col gap-3" onSubmit={save}>
      <fieldset className="flex flex-col gap-2">
        <legend className={labelClass}>Allocation rule</legend>
        {ALLOCATION_RULES.map((rule) => (
          <label key={rule} className="flex items-start gap-2">
            <input
              type="radio"
              name="allocationRule"
              value={rule}
              checked={fields.allocationRule === rule}
              onChange={() => edit({ ...fields, allocationRule: rule })}
            />
            <span className="flex flex-col">
              <span className="text-sm">{ALLOCATION_RULE_LABEL[rule].label}</span>
              <span className="text-xs text-(--muted-foreground)">{ALLOCATION_RULE_LABEL[rule].explain}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="flex max-w-xs flex-col gap-1">
        <span className={labelClass}>Minimum remaining shelf life at dispatch (days)</span>
        <input
          className={inputClass}
          name="minOutboundShelfLifeDays"
          inputMode="numeric"
          value={fields.minDays}
          placeholder="None"
          aria-invalid={problem !== null}
          onChange={(event) => edit({ ...fields, minDays: event.target.value })}
        />
        <span className="text-xs text-(--muted-foreground)">
          {MIN_OUTBOUND_SHELF_LIFE_DAYS_MIN}–{MIN_OUTBOUND_SHELF_LIFE_DAYS_MAX} days, blank for none. A batch with fewer days left is never picked for this client&apos;s orders.
        </span>
        {problem !== null ? (
          <span role="alert" data-field="minDays" className="text-xs text-(--destructive)">
            {problem}
          </span>
        ) : null}
      </label>

      {warningList}
      {notes}

      <div>
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? 'Saving…' : 'Save allocation policy'}
        </button>
      </div>

      {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}
    </form>
  );
}
