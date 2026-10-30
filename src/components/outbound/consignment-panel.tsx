'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiRecordConsignment, fetchApiWithdrawConsignment } from '@/lib/api/client';
import type { ConsignmentViewDto, OrderConsignmentResponse } from '@/lib/api/generated';
import { istDateTimeLabel } from '@/lib/audit-exports';
import { readSession, subscribeSession } from '@/lib/auth';
import {
  brandDocumentLine,
  COMPLIANCE_EXCEPTION_WORD,
  consignmentReason,
  consignmentRefusalReloads,
  CONSIGNMENT_RECORD_LIMITS,
  draftFromView,
  emptyConsignmentRecordDraft,
  ewayLine,
  ewayValidityWarning,
  ewayVerdictLine,
  formatRupees,
  gateChip,
  gateLine,
  historyLine,
} from '@/lib/consignment';
import { DOC_KIND_WORD, type DocKind } from '@/lib/shipping';
import { notifyOutboundChanged } from '@/lib/outbound';
import type { OrderStatus } from '@/lib/outbound-orders';
import { useOrderConsignment } from '@/lib/use-consignment';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { buttonClass, destructiveClass, inputClass, ReadFailure, rowButtonClass } from '@/components/shared/surface';
import { ConsignmentForm } from '@/components/shared/consignment-form';
import { StatusChip } from '@/components/shared/status-chip';

const instant = (iso: string) => `${istDateTimeLabel(iso)} IST`;

/**
 * Story 4-6a (A24) — the order's Tax documents panel (the expanded order on
 * the Orders tab, on Pack & Dispatch and on the Documents worklist): the gate
 * line, the live version as a fact list, its warnings (duplicates, consignor
 * state, the value under the rated value, an expiring bill, the same e-way
 * number under another client), the history, 4-4a's scans, and Record /
 * Amend / Withdraw.
 *
 * Every read is ungated; each action is hidden without its capability (A46):
 * record and amend before dispatch `dispatch.execute`; an amendment after
 * dispatch, an exemption, and withdraw `orders.manage`. The role is read
 * through the session subscription.
 */
export function ConsignmentPanel({
  orderId,
  orderLabel,
  status,
  createdAt,
  clientCode = null,
  defaultOpen = false,
}: {
  orderId: string;
  orderLabel: string;
  status: OrderStatus;
  createdAt: string;
  clientCode?: string | null;
  /** The Documents worklist's "Record" opens the form at once. */
  defaultOpen?: boolean;
}) {
  const read = useOrderConsignment(orderId);
  const role = useSyncExternalStore(subscribeSession, () => readSession()?.user.role, () => undefined);
  const canDispatch = roleHasCapability(role, 'dispatch.execute');
  const canManage = roleHasCapability(role, 'orders.manage');
  const [mode, setMode] = useState<'view' | 'form' | 'withdraw'>(defaultOpen ? 'form' : 'view');
  const [outcome, setOutcome] = useState<{ tone: 'accepted' | 'rejected'; word: string; reason: string } | null>(null);

  if (read.state === 'loading') return <div className="text-xs text-(--muted-foreground)">Loading tax documents…</div>;
  if (read.state === 'failed') return <ReadFailure word="Tax documents unavailable" reason={read.reason} onRetry={read.reload} />;
  // An API without the route (guide §1.13): nothing to say.
  if (read.data === null) return null;

  const data = read.data;
  const live = data.live;
  const dispatched = status === 'dispatched';
  const open = status === 'accepted' || status === 'ready_to_dispatch';
  const applicable = data.gate.state !== 'not-applicable';
  const canRecord = applicable && (open ? canDispatch : dispatched && canManage);
  const canWithdraw = applicable && open && live !== null && canManage;
  const chip = gateChip(data.gate.state, data.gate.expiresToday);

  return (
    <section aria-label="Tax documents" className="flex flex-col gap-2 rounded-sm border border-(--border) p-3 text-xs" data-testid="consignment-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">Tax documents</h3>
        {chip !== null && (
          <StatusChip tone={chip.tone} data-testid="consignment-gate-chip">
            {chip.word}
          </StatusChip>
        )}
      </div>
      <p data-testid="consignment-gate-line">{gateLine(data.gate, { clientCode, orderStatus: status })}</p>

      {data.complianceException !== null && (
        <FeedbackBanner
          tone="warning"
          word={(COMPLIANCE_EXCEPTION_WORD as Readonly<Record<string, string>>)[data.complianceException] ?? 'Left without the brand’s documents'}
          reason={
            live === null
              ? 'A handheld handed this parcel over on an old snapshot. Record the brand’s documents to clear it from the worklist.'
              : 'A handheld handed this parcel over without them; a record made since is shown below.'
          }
        />
      )}

      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}

      {live !== null && <LiveVersion view={live} data={data} />}

      {mode === 'view' && (canRecord || canWithdraw) && (
        <div className="flex flex-wrap gap-2">
          {canRecord && (
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setOutcome(null);
                setMode('form');
              }}
              data-testid="consignment-record"
            >
              {live === null ? 'Record the brand’s documents' : 'Amend'}
            </button>
          )}
          {canWithdraw && (
            <button
              type="button"
              className={rowButtonClass}
              onClick={() => {
                setOutcome(null);
                setMode('withdraw');
              }}
              data-testid="consignment-withdraw"
            >
              Withdraw
            </button>
          )}
        </div>
      )}

      {mode === 'form' && canRecord && (
        <ConsignmentForm
          initial={live === null ? emptyConsignmentRecordDraft() : draftFromView(live)}
          createdAt={createdAt}
          reasonRequired={dispatched}
          canExempt={canManage}
          exemptDisabledNote="Only an office role can record an e-way exemption."
          consignorHint="Leave blank to use the client’s GSTIN on file — or the registration the brand’s document names."
          submitLabel={live === null ? 'Record' : 'Save amendment'}
          reasonOf={consignmentReason}
          submit={async (body, key) => {
            const session = readSession();
            if (session === null) throw new Error('Your session expired — sign in again.');
            try {
              const response = await fetchApiRecordConsignment(session.tenant.id, orderId, body, key);
              setOutcome(
                response.unchanged === true
                  ? { tone: 'accepted', word: 'Nothing changed', reason: `The record of ${orderLabel} already says this.` }
                  : { tone: 'accepted', word: `Recorded — v${response.consignment.seq}`, reason: `${brandDocumentLine(response.consignment.brandDocument)} on ${orderLabel}.` },
              );
              setMode('view');
              notifyOutboundChanged();
            } catch (error) {
              if (consignmentRefusalReloads(error)) read.reload();
              throw error;
            }
          }}
          onDiscard={() => setMode('view')}
        />
      )}

      {mode === 'withdraw' && canWithdraw && (
        <WithdrawConfirm
          orderId={orderId}
          orderLabel={orderLabel}
          onDone={(result) => {
            setOutcome(result);
            setMode('view');
          }}
          onCancel={() => setMode('view')}
          onStale={read.reload}
        />
      )}

      {data.history.length > 0 && (
        <details data-testid="consignment-history">
          <summary className="cursor-pointer text-(--muted-foreground)">Earlier versions ({data.history.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {data.history.map((old) => (
              <li key={old.id} className="text-(--muted-foreground)">
                {historyLine(old, instant)} · {brandDocumentLine(old.brandDocument)} · {ewayLine(old.eway)}
                {old.id === data.dispatchedRecordId ? ' · the goods left under this version' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}

      {data.scans.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="consignment-scans">
          <div className="font-medium">Scans attached</div>
          <ul className="flex flex-col gap-0.5">
            {data.scans.map((scan) => (
              <li key={scan.id}>
                {scan.url === null ? (
                  <span>{scan.fileName}</span>
                ) : (
                  <a href={scan.url} target="_blank" rel="noreferrer" className="text-(--primary) underline underline-offset-2">
                    {scan.fileName}
                  </a>
                )}{' '}
                <span className="text-(--muted-foreground)">
                  · {scan.docKind === null ? 'Document' : ((DOC_KIND_WORD as Readonly<Record<string, string>>)[scan.docKind as DocKind] ?? scan.docKind)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function LiveVersion({ view, data }: { view: ConsignmentViewDto; data: OrderConsignmentResponse }) {
  const [nowMs] = useState(() => Date.now());
  const validity = view.eway.status === 'recorded' ? ewayValidityWarning(view.eway.validUntil, nowMs) : null;
  const warnings: string[] = [];
  if (data.duplicates.length > 0) {
    warnings.push(`The same document is recorded on ${data.duplicates.map((d) => d.orderLabel).join(', ')} — check it is not a copy-paste.`);
  }
  if (data.consignorStateMismatch) {
    warnings.push('The consignor GSTIN is registered in another state than the warehouse — the brand’s document normally names its registration in the dispatching state.');
  }
  if (data.ewayUsedByOtherClient !== null) {
    warnings.push(`The same e-way bill number is live on ${data.ewayUsedByOtherClient.orderLabel} of ${data.ewayUsedByOtherClient.clientCode} — check the number.`);
  }
  if (view.declaredBelowRatedValue === true) {
    warnings.push('The declared value is below the order’s own rated value — check the brand’s document (a short shipment can explain it).');
  }
  if (validity !== null) warnings.push(validity);
  return (
    <div className="flex flex-col gap-1" data-testid="consignment-live">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-(--muted-foreground)">Document</dt>
        <dd data-testid="consignment-live-document">{brandDocumentLine(view.brandDocument)}</dd>
        <dt className="text-(--muted-foreground)">Consignor</dt>
        <dd>
          <span className="font-mono">{view.consignorGstin}</span>
          {view.consignor.legalName !== null || view.consignor.name !== null ? ` — ${view.consignor.legalName ?? view.consignor.name}` : ''}
        </dd>
        <dt className="text-(--muted-foreground)">Declared value</dt>
        <dd className="data">{formatRupees(view.declaredValuePaise)}</dd>
        <dt className="text-(--muted-foreground)">E-way bill</dt>
        <dd>
          <span className="block" data-testid="consignment-live-verdict">
            {ewayVerdictLine(view)}
          </span>
          <span className="block" data-testid="consignment-live-eway">
            {ewayLine(view.eway)}
          </span>
        </dd>
        <dt className="text-(--muted-foreground)">Recorded</dt>
        <dd>
          v{view.seq} · {instant(view.recordedAt)} · {view.source === 'portal' ? 'by the brand in its portal' : 'by the warehouse'}
          {view.recordedAfterDispatch ? ' · after dispatch' : ''}
          {view.dispatchedAt !== null ? ` · the goods left under it ${instant(view.dispatchedAt)}` : ''}
        </dd>
      </dl>
      {warnings.map((warning) => (
        <div key={warning} className="text-(--warning)" data-testid="consignment-warning">
          ⚠ {warning}
        </div>
      ))}
    </div>
  );
}

/** Withdraw with a reason — one key per confirmation, bound to the reason (it is hashed). */
function WithdrawConfirm({
  orderId,
  orderLabel,
  onDone,
  onCancel,
  onStale,
}: {
  orderId: string;
  orderLabel: string;
  onDone: (outcome: { tone: 'accepted' | 'rejected'; word: string; reason: string }) => void;
  onCancel: () => void;
  onStale: () => void;
}) {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef<{ key: string; reason: string } | null>(null);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const text = reason.trim();
    if (text === '') {
      setProblem('Say why the record is withdrawn.');
      return;
    }
    const session = readSession();
    if (session === null) {
      setProblem('Your session expired — sign in again.');
      return;
    }
    if (keyRef.current === null || keyRef.current.reason !== text) keyRef.current = { key: ulid(), reason: text };
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await fetchApiWithdrawConsignment(session.tenant.id, orderId, text, keyRef.current.key);
      keyRef.current = null;
      notifyOutboundChanged();
      onDone({ tone: 'accepted', word: 'Withdrawn', reason: `${orderLabel} has no live record now — it cannot leave until one is recorded, if its rule requires one.` });
    } catch (error) {
      setProblem(consignmentReason(error));
      if (consignmentRefusalReloads(error)) onStale();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={confirm} className="flex flex-col gap-2 rounded-sm border border-(--destructive) p-2" data-testid="consignment-withdraw-confirm">
      <label className="flex flex-col gap-1">
        <span className="font-medium">Withdraw the record of {orderLabel}? Why</span>
        <input
          className={inputClass}
          value={reason}
          maxLength={CONSIGNMENT_RECORD_LIMITS.reason}
          onChange={(e) => {
            setReason(e.target.value);
            setProblem(null);
          }}
          disabled={busy}
          data-testid="consignment-withdraw-reason"
        />
      </label>
      {problem !== null && (
        <div role="alert" className="text-(--destructive)">
          {problem}
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" className={destructiveClass} disabled={busy} data-testid="consignment-withdraw-confirm-button">
          {busy ? 'Withdrawing…' : 'Withdraw'}
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={onCancel}>
          Keep it
        </button>
      </div>
    </form>
  );
}
