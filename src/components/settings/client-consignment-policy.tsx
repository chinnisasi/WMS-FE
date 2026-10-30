'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { fetchApiUpdateClientConsignmentPolicy } from '@/lib/api/client';
import type { ClientDto } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import { consignmentPolicyReason, DOCUMENT_RULE_LABEL, DOCUMENT_RULE_NOTE, DOCUMENT_RULES, type ConsignmentDocumentRule } from '@/lib/consignment';
import { ulid } from '@/lib/ulid';
import { useClientConsignmentPolicy } from '@/lib/use-client-consignment-policy';

import { FeedbackBanner } from '@/components/feedback/banner';
import { primaryClass, ReadFailure, rowButtonClass } from '@/components/shared/surface';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/**
 * Story 4-6a (A11, A24) — Settings → Clients → Consignment documents: which of
 * a client's orders need the brand's invoice (or challan) and e-way bill
 * before they leave — B2B orders (the default), every order, or only
 * high-value ones. Every staff session reads it; an owner (`clients.manage`)
 * changes it. One key per draft (the `client-allocation-policy.tsx`
 * pattern): minted on the first save, reused across retries of the same
 * rule, cleared on success and on any change. Never offered for the self
 * client (its goods are invoiced by the WMS).
 */
export function ClientConsignmentPolicyPanel({
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
  const policy = useClientConsignmentPolicy(client.id);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-md border border-(--border) p-3" data-testid="client-consignment-policy">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-medium outline-none">
          Consignment documents — {client.code}
        </h3>
        <button type="button" onClick={onClose} className={rowButtonClass}>
          Close
        </button>
      </div>
      {policy.state === 'failed' ? (
        <ReadFailure word="Documents rule unavailable" reason={policy.reason} onRetry={policy.reload} />
      ) : policy.state === 'loading' ? (
        <div className="text-(--muted-foreground)">Loading the documents rule…</div>
      ) : (
        <PolicyBody client={client} stored={policy.data.documentRule} canManage={canManage} onSaved={onSaved} onDirtyChange={onDirtyChange} />
      )}
    </section>
  );
}

function PolicyBody({
  client,
  stored,
  canManage,
  onSaved,
  onDirtyChange,
}: {
  client: ClientDto;
  stored: ConsignmentDocumentRule;
  canManage: boolean;
  onSaved: (client: ClientDto) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [current, setCurrent] = useState<ConsignmentDocumentRule>(stored);
  const [rule, setRule] = useState<ConsignmentDocumentRule>(stored);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  function pick(next: ConsignmentDocumentRule) {
    keyRef.current = null;
    setOutcome(null);
    setRule(next);
    onDirtyChange(next !== current);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setBusy(true);
    setOutcome(null);
    keyRef.current ??= ulid();
    try {
      const saved = await fetchApiUpdateClientConsignmentPolicy(session.tenant.id, client.id, { documentRule: rule }, keyRef.current);
      keyRef.current = null;
      const next = saved.consignmentPolicy?.documentRule ?? rule;
      setCurrent(next);
      setRule(next);
      onDirtyChange(false);
      setOutcome({ tone: 'accepted', word: 'Documents rule saved', reason: `${client.code}: ${DOCUMENT_RULE_LABEL[next].label}. Open orders are judged by it from now on.` });
      onSaved(saved);
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Documents rule not saved', reason: consignmentPolicyReason(error) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <>
        <dl className="grid gap-1">
          <dt className="text-sm font-medium">Orders that need the brand’s documents</dt>
          <dd data-testid="consignment-rule-read">{DOCUMENT_RULE_LABEL[current].label}</dd>
        </dl>
        <p className="text-xs text-(--muted-foreground)">{DOCUMENT_RULE_NOTE}</p>
      </>
    );
  }

  return (
    <form aria-label={`Consignment documents rule of ${client.code}`} className="flex flex-col gap-3" onSubmit={save}>
      <fieldset className="flex flex-col gap-2" disabled={busy}>
        <legend className="text-sm font-medium">Orders that need the brand’s invoice and e-way bill before they leave</legend>
        {DOCUMENT_RULES.map((option) => (
          <label key={option} className="flex items-start gap-2">
            <input type="radio" name="documentRule" value={option} checked={rule === option} onChange={() => pick(option)} />
            <span className="flex flex-col">
              <span className="text-sm">{DOCUMENT_RULE_LABEL[option].label}</span>
              <span className="text-xs text-(--muted-foreground)">{DOCUMENT_RULE_LABEL[option].explain}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-(--muted-foreground)">{DOCUMENT_RULE_NOTE}</p>
      <div>
        <button type="submit" disabled={busy || rule === current} className={primaryClass} data-testid="consignment-rule-save">
          {busy ? 'Saving…' : 'Save documents rule'}
        </button>
      </div>
      {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}
    </form>
  );
}
