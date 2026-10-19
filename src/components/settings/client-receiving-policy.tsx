'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { fetchApiUpdateClientReceivingPolicy } from '@/lib/api/client';
import type { ClientDto, ClientReceivingPolicyResponse } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import {
  MIN_SHELF_LIFE_DAYS_MAX,
  MIN_SHELF_LIFE_DAYS_MIN,
  QC_NOT_HELD_NOTE,
  expiryRequiredLabel,
  minShelfLifeLabel,
  parseReceivingPolicyDraft,
  qcOnReceiptLabel,
  receivingPolicyFieldOf,
  receivingPolicyFieldsOf,
  receivingPolicyReason,
  receivingPolicySaved,
  receivingToleranceLabel,
  untrackedSkusNote,
  type ReceivingPolicy,
  type ReceivingPolicyField,
  type ReceivingPolicyFields,
} from '@/lib/clients';
import { ulid } from '@/lib/ulid';
import { useClientReceivingPolicy } from '@/lib/use-client-receiving-policy';

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
 * Story 1-2b — a client's receiving policy: over-receipt tolerance (a
 * percent on screen, basis points on the wire), QC on receipt, expiry
 * required and the minimum remaining shelf life. Every staff session reads
 * it (`self` and departed clients included); an owner (`canManage`, the
 * `clients.manage` capability) edits. The save is a FULL replace of the four
 * fields under a per-draft Idempotency-Key (ref form): minted on the first
 * submit, reused across retries of the unchanged draft, cleared on success
 * and on any edit. A `validation-failed` renders under the field its detail
 * names.
 */
export function ClientReceivingPolicyPanel({
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
  const policy = useClientReceivingPolicy(client.id);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-md border border-(--border) p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-medium outline-none">
          Receiving policy — {client.code}
        </h3>
        <button type="button" onClick={onClose} className={rowButtonClass}>
          Close
        </button>
      </div>

      {policy.state === 'failed' ? (
        <ReadFailure word="Receiving policy unavailable" reason={policy.reason} onRetry={policy.reload} />
      ) : policy.state === 'loading' ? (
        <div className="text-(--muted-foreground)">Loading the receiving policy…</div>
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
  read: ClientReceivingPolicyResponse;
  canManage: boolean;
  onSaved: (client: ClientDto) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [current, setCurrent] = useState<ReceivingPolicy>(read);
  const [fields, setFields] = useState<ReceivingPolicyFields>(() => receivingPolicyFieldsOf(read));
  const [problems, setProblems] = useState<Partial<Record<ReceivingPolicyField, string>>>({});
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  // A pre-render double-click fires both handlers before `disabled` renders.
  const inFlight = useRef(false);

  const edit = (next: ReceivingPolicyFields) => {
    keyRef.current = null;
    setFields(next);
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(receivingPolicyFieldsOf(current)));
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseReceivingPolicyDraft(fields);
    if (parsed.body === null) {
      setProblems(parsed.problems);
      return;
    }
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setProblems({});
    setOutcome(null);
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const saved = await fetchApiUpdateClientReceivingPolicy(session.tenant.id, client.id, parsed.body, keyRef.current);
      keyRef.current = null;
      // The answer's policy when it carries one (a replayed pre-1-2b answer
      // may not), else what this full replace sent.
      const next = saved.receivingPolicy ?? parsed.body;
      setCurrent(next);
      setFields(receivingPolicyFieldsOf(next));
      onDirtyChange(false);
      setOutcome({ tone: 'accepted', ...receivingPolicySaved(client.code) });
      onSaved(saved);
    } catch (error) {
      const field = receivingPolicyFieldOf(error);
      if (field !== null) setProblems({ [field]: receivingPolicyReason(error) });
      else setOutcome({ tone: 'rejected', word: 'Receiving policy not saved', reason: receivingPolicyReason(error) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const notes = (
    <ul className="flex list-disc flex-col gap-0.5 pl-5 text-xs text-(--muted-foreground)">
      <li>{untrackedSkusNote(read.untrackedSkuCount)}</li>
      <li>{QC_NOT_HELD_NOTE}</li>
    </ul>
  );

  if (!canManage) {
    return (
      <>
        <dl className="grid gap-1">
          <dt className={labelClass}>Over-receipt tolerance</dt>
          <dd>{receivingToleranceLabel(current.receivingToleranceBps)}</dd>
          <dt className={labelClass}>QC on receipt</dt>
          <dd>{qcOnReceiptLabel(current.qcOnReceipt)}</dd>
          <dt className={labelClass}>Expiry date</dt>
          <dd>{expiryRequiredLabel(current.expiryRequired)}</dd>
          <dt className={labelClass}>Minimum remaining shelf life</dt>
          <dd>{minShelfLifeLabel(current.minShelfLifeDays)}</dd>
        </dl>
        {notes}
      </>
    );
  }

  return (
    <form aria-label={`Receiving policy of ${client.code}`} className="flex flex-col gap-3" onSubmit={save}>
      <label className="flex max-w-xs flex-col gap-1">
        <span className={labelClass}>Over-receipt tolerance (%)</span>
        <input
          className={inputClass}
          name="tolerancePercent"
          inputMode="decimal"
          value={fields.tolerancePercent}
          aria-invalid={problems.tolerance !== undefined}
          onChange={(event) => edit({ ...fields, tolerancePercent: event.target.value })}
        />
        <span className="text-xs text-(--muted-foreground)">
          Quantity over the PO or ASN within this share books at once; the rest waits for approval. 0 = every excess waits.
        </span>
        {problems.tolerance !== undefined ? (
          <span role="alert" data-field="tolerance" className="text-xs text-(--destructive)">
            {problems.tolerance}
          </span>
        ) : null}
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="qcOnReceipt"
          checked={fields.qcOnReceipt}
          onChange={(event) => edit({ ...fields, qcOnReceipt: event.target.checked })}
        />
        <span className={labelClass}>QC on receipt — hold every booked line until QC releases it</span>
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="expiryRequired"
          checked={fields.expiryRequired}
          // A minimum is meaningful only beside a required expiry: unticking
          // clears it (the backend 400s a minimum without expiryRequired).
          onChange={(event) =>
            edit({ ...fields, expiryRequired: event.target.checked, minShelfLifeDays: event.target.checked ? fields.minShelfLifeDays : '' })
          }
        />
        <span className={labelClass}>Expiry date required on batch-tracked lines</span>
      </label>

      <label className="flex max-w-xs flex-col gap-1">
        <span className={labelClass}>Minimum remaining shelf life (days)</span>
        <input
          className={inputClass}
          name="minShelfLifeDays"
          inputMode="numeric"
          value={fields.minShelfLifeDays}
          disabled={!fields.expiryRequired}
          placeholder="None"
          aria-invalid={problems.minShelfLife !== undefined}
          onChange={(event) => edit({ ...fields, minShelfLifeDays: event.target.value })}
        />
        <span className="text-xs text-(--muted-foreground)">
          {MIN_SHELF_LIFE_DAYS_MIN}–{MIN_SHELF_LIFE_DAYS_MAX} days, needs Expiry date required. A line with fewer days left is not booked and goes to review.
        </span>
        {problems.minShelfLife !== undefined ? (
          <span role="alert" data-field="minShelfLife" className="text-xs text-(--destructive)">
            {problems.minShelfLife}
          </span>
        ) : null}
      </label>

      {notes}

      <div>
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? 'Saving…' : 'Save receiving policy'}
        </button>
      </div>

      {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}
    </form>
  );
}
