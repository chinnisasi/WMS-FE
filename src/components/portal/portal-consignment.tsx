'use client';

import { useEffect, useRef, useState } from 'react';

import { fetchApiPortalRecordConsignment } from '@/lib/api/client';
import type { PortalConsignmentNeededRowDto, PortalConsignmentViewDto } from '@/lib/api/generated';
import {
  brandDocumentLine,
  CONSIGNMENT_STAGE_WORD,
  consignmentReason,
  consignmentRefusalReloads,
  draftFromView,
  emptyConsignmentRecordDraft,
  ewayLine,
  ewayValidityWarning,
  ewayVerdictLine,
  formatRupees,
  gateChip,
  historyLine,
  portalGateLine,
} from '@/lib/consignment';
import { portalDate, PORTAL_SESSION_EXPIRED } from '@/lib/portal';
import { usePortalOrderConsignment, usePortalTenantId } from '@/lib/use-portal';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ConsignmentForm } from '@/components/shared/consignment-form';
import { StatusChip } from '@/components/shared/status-chip';
import { buttonClass, ReadFailure, rowButtonClass } from '@/components/shared/surface';

/**
 * Story 4-6a (A18, A26) — the order detail's Tax documents section in the
 * client portal: the gate in the client's words ("We need your tax invoice
 * before this order can leave"), the live version and its history, and
 * Record / Amend (`orders.place`) — the same form and rules as the staff
 * panel, the consignor defaulting to the client's GSTIN on the server. The
 * portal never sees the warehouse's exception flag or another client's
 * duplicate (the server's allowlisted view).
 */
export function PortalConsignment({
  orderId,
  orderReference,
  status,
  createdAt,
  canWrite,
  focus = false,
  onRecorded,
}: {
  orderId: string;
  orderReference: string;
  status: 'accepted' | 'ready_to_dispatch' | 'dispatched' | 'cancelled';
  createdAt: string;
  canWrite: boolean;
  /** `?tab=documents` (the documents-needed email's link): scroll here and open the form when something is owed. */
  focus?: boolean;
  /** A record changed what is owed: the page's needed banner re-reads. */
  onRecorded?: () => void;
}) {
  const tenantId = usePortalTenantId();
  const read = usePortalOrderConsignment(orderId);
  const [formOpen, setFormOpen] = useState<boolean | null>(null);
  const [outcome, setOutcome] = useState<{ word: string; reason: string } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  // The section mounts only once the read is ready: scroll then, not while it loads (the ref is null).
  const ready = read.state === 'ready';
  useEffect(() => {
    if (focus && ready) sectionRef.current?.scrollIntoView?.({ block: 'start' });
  }, [focus, ready]);

  if (read.state === 'loading') return <div className="text-xs text-(--muted-foreground)">Loading tax documents…</div>;
  if (read.state === 'failed') {
    // An API without the route says nothing (guide §1.13); the order detail owns the order's own 404.
    if (read.notFound) return null;
    return <ReadFailure word="Tax documents not loaded" reason={read.reason} onRetry={read.reload} />;
  }
  const data = read.data;
  const live = data.live;
  const open = status === 'accepted' || status === 'ready_to_dispatch';
  const writable = canWrite && (open || status === 'dispatched') && data.gate.state !== 'not-applicable';
  // The form opens itself on a documents link when something is owed; otherwise on Record / Amend.
  const showForm = writable && (formOpen ?? (focus && data.gate.blocking));
  const chip = gateChip(data.gate.state, data.gate.expiresToday);

  return (
    <section ref={sectionRef} aria-label="Tax documents" className="flex flex-col gap-2 rounded-md border border-(--border) p-3 text-sm" data-testid="portal-consignment">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">Tax documents</h3>
        {chip !== null && <StatusChip tone={chip.tone}>{chip.word}</StatusChip>}
      </div>
      <p data-testid="portal-consignment-gate">{portalGateLine(data.gate)}</p>
      {outcome !== null && <FeedbackBanner tone="accepted" word={outcome.word} reason={outcome.reason} />}
      {live !== null && <PortalLiveVersion view={live} />}
      {writable && !showForm && (
        <div>
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              setOutcome(null);
              setFormOpen(true);
            }}
            data-testid="portal-consignment-record"
          >
            {live === null ? 'Record your invoice and e-way bill' : 'Amend'}
          </button>
        </div>
      )}
      {showForm && (
        <ConsignmentForm
          testId="portal-consignment-form"
          initial={live === null ? emptyConsignmentRecordDraft() : draftFromView(live)}
          createdAt={createdAt}
          reasonRequired={status === 'dispatched'}
          canExempt
          consignorHint="Leave blank to use your GSTIN on file — or enter the registration your document names (the one in the warehouse’s state)."
          submitLabel={live === null ? 'Record' : 'Save amendment'}
          reasonOf={consignmentReason}
          submit={async (body, key) => {
            if (tenantId === null) throw new Error(PORTAL_SESSION_EXPIRED);
            let response;
            try {
              response = await fetchApiPortalRecordConsignment(tenantId, orderId, body, key);
            } catch (error) {
              // The order moved (left, cancelled, gone): re-read quietly — the form and its refusal stay.
              if (consignmentRefusalReloads(error)) void read.refresh();
              throw error;
            }
            setOutcome(
              response.unchanged === true
                ? { word: 'Nothing changed', reason: 'Your record already says this.' }
                : { word: 'Recorded', reason: `${brandDocumentLine(response.consignment.brandDocument)} on order ${orderReference}.` },
            );
            setFormOpen(false);
            await read.refresh();
            onRecorded?.();
          }}
          onDiscard={() => setFormOpen(false)}
        />
      )}
      {data.history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-(--muted-foreground)">Earlier versions ({data.history.length})</summary>
          <ul className="mt-1 flex flex-col gap-1 text-xs text-(--muted-foreground)">
            {data.history.map((old) => (
              <li key={old.id}>
                {historyLine(old, portalDate)} · {brandDocumentLine(old.brandDocument)} · {ewayLine(old.eway)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function PortalLiveVersion({ view }: { view: PortalConsignmentViewDto }) {
  const [nowMs] = useState(() => Date.now());
  const validity = view.eway.status === 'recorded' ? ewayValidityWarning(view.eway.validUntil, nowMs) : null;
  return (
    <div className="flex flex-col gap-1 text-xs" data-testid="portal-consignment-live">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-(--muted-foreground)">Document</dt>
        <dd>{brandDocumentLine(view.brandDocument)}</dd>
        <dt className="text-(--muted-foreground)">GSTIN</dt>
        <dd className="font-mono">{view.consignorGstin}</dd>
        <dt className="text-(--muted-foreground)">Declared value</dt>
        <dd className="data">{formatRupees(view.declaredValuePaise)}</dd>
        <dt className="text-(--muted-foreground)">E-way bill</dt>
        <dd>
          <span className="block">{ewayVerdictLine(view)}</span>
          <span className="block">{ewayLine(view.eway)}</span>
        </dd>
        <dt className="text-(--muted-foreground)">Recorded</dt>
        <dd>
          {portalDate(view.recordedAt)} · {view.recordedByYou ? 'by you' : view.source === 'portal' ? 'in your portal' : 'by the warehouse'}
        </dd>
      </dl>
      {validity !== null && <div className="text-(--warning)">⚠ {validity}</div>}
    </div>
  );
}

/**
 * Story 4-6a (A26) — the Orders page's banner: "3 orders are waiting for your
 * invoice or e-way bill", opening the list of them with each one's stage and
 * what it needs.
 */
export function PortalNeededList({
  items,
  onOpen,
}: {
  items: readonly PortalConsignmentNeededRowDto[];
  onOpen: (orderId: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-1 text-sm" data-testid="portal-needed-list">
      {items.map((row) => {
        const chip = gateChip(row.state, row.state === 'ready');
        return (
          <li key={row.orderId} className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{row.clientOrderRef ?? row.orderLabel}</span>
            <span className="text-xs text-(--muted-foreground)">{CONSIGNMENT_STAGE_WORD[row.stage]}</span>
            {chip !== null && <StatusChip tone={chip.tone}>{chip.word}</StatusChip>}
            <button type="button" className={rowButtonClass} onClick={() => onOpen(row.orderId)} data-testid="portal-needed-open">
              Record
            </button>
          </li>
        );
      })}
    </ul>
  );
}
