'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiPutNotePolicy } from '@/lib/api/client';
import { readSession, subscribeSession } from '@/lib/auth';
import { notePolicyRefusalReason } from '@/lib/client-invoice-notes';
import { notifyClientInvoicesChanged } from '@/lib/client-invoices';
import { ulid } from '@/lib/ulid';
import { useNotePolicy } from '@/lib/use-client-invoice-notes';
import { roleHasCapability } from '@/lib/users';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ReadFailure, Section } from '@/components/shared/surface';

/**
 * Story 5-6a (A7) — the credit-note maker/checker switch. Every member reads
 * it; only the owner (`billing.configure`) changes it. With it on (the
 * default — no setting means on), the person who drafts a credit note cannot
 * issue it, and the person who issues one cannot void it. A one-person
 * business turns it off. A change is keyed per click and audited.
 */
export function NotePolicyCard() {
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canConfigure = roleHasCapability(role, 'billing.configure');
  const policy = useNotePolicy();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: 'accepted' | 'rejected'; word: string; reason: string } | null>(null);
  const inFlight = useRef(false);

  async function toggle(next: boolean) {
    const session = readSession();
    if (session === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await fetchApiPutNotePolicy(session.tenant.id, next, ulid());
      setOutcome({
        tone: 'accepted',
        word: next ? 'Second person required' : 'Second person not required',
        reason: next ? 'A credit note’s creator can no longer issue it, nor its issuer void it.' : 'Anyone with billing rights can now draft, issue and void a credit note alone.',
      });
      notifyClientInvoicesChanged();
      policy.reload();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not changed', reason: notePolicyRefusalReason(error) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Section title="Credit notes">
      <div className="text-(--muted-foreground)">
        A credit note returns money to a client. By default a second person must issue it — not the one who drafted it — and another must void it.
      </div>
      {policy.state === 'failed' ? (
        <ReadFailure word="Setting unavailable" reason={policy.reason} onRetry={policy.reload} />
      ) : policy.state === 'loading' ? (
        <div className="text-(--muted-foreground)">Loading…</div>
      ) : (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={policy.data.requireSecondApprover}
            disabled={!canConfigure || busy}
            aria-describedby="note-policy-hint"
            onChange={(event) => toggle(event.target.checked)}
          />
          <span>Require a second person to issue credit notes (and another to void them)</span>
        </label>
      )}
      <div id="note-policy-hint" className="text-xs text-(--muted-foreground)">
        {canConfigure ? 'Owner only. Turn it off only if one person runs billing.' : 'Only the owner can change this.'}
      </div>
      {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}
    </Section>
  );
}
