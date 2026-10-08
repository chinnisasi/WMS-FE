'use client';

import { useState, useSyncExternalStore } from 'react';

import {
  fetchApiApproveOverReceipt,
  fetchApiRejectOverReceipt,
} from '@/lib/api/client';
import type { OverReceiptDto, SkuResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { quantityLabel } from '@/lib/format-quantity';
import { approvedReason, decisionReason, openQtyLabel, overReceiptDocumentLabel } from '@/lib/over-receipt';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { useOverReceipts, useSkuMap, useUserMap } from '@/lib/use-inbound';

import { FeedbackBanner } from '@/components/feedback/banner';

/**
 * The Conflicts & Reviews queue (story 3.3) — over-receipt decisions. A GRN
 * that received past a document line's open quantity — a PO line, or (story
 * 21-6) an ASN line — applied the within-open part immediately and parked
 * the excess here; Approve applies the excess (a new `grn.received` ledger
 * event + the line's receivedQty), Reject leaves it unapplied. Every decision is audit-trailed server-side; the buttons carry
 * a fresh ULID Idempotency-Key so a double click replays, never duplicates.
 *
 * The surface itself is nav-gated behind `review.decide`; the buttons are
 * gated again here so a direct URL visit renders read-only instead of a
 * blocked screen (hide surfaces, never "blocked" screens — the backend's
 * per-command role read remains the authority).
 */

const statusTabs = ['pending', 'approved', 'rejected'] as const;
type StatusTab = (typeof statusTabs)[number];

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

const TAB_LABEL: Record<StatusTab, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

export function OverReceiptQueue() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Conflicts & Reviews</div>
        <div className="text-(--muted-foreground)">Sign in to review over-receipts.</div>
      </div>
    );
  }
  return <OverReceiptQueueSessioned />;
}

function OverReceiptQueueSessioned() {
  const [tab, setTab] = useState<StatusTab>('pending');
  const queue = useOverReceipts(tab);
  const skus = useSkuMap();
  const users = useUserMap();
  // Story 1.5 gating pattern: subscribed (not a bare readSession() at
  // render) so a /me bootstrap role rewrite re-renders the actions.
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canDecide = roleHasCapability(role, 'review.decide');

  const [outcome, setOutcome] = useState<Outcome>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  async function decide(entry: OverReceiptDto, decision: 'approve' | 'reject') {
    const session = readSession();
    if (session === null) return;
    setDecidingId(entry.id);
    setOutcome(null);
    try {
      const decided =
        decision === 'approve'
          ? await fetchApiApproveOverReceipt(session.tenant.id, entry.id, ulid())
          : await fetchApiRejectOverReceipt(session.tenant.id, entry.id, ulid());
      setOutcome({
        tone: 'accepted',
        word: `${entry.grnCode} over-receipt ${decided.overReceipt.status}`,
        reason:
          decision === 'approve'
            ? approvedReason(entry)
            : 'The excess stays unapplied; the decision is audit-trailed.',
      });
      queue?.reload();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not decided', reason: decisionReason(error) });
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Over-receipts</h2>
        <div className="text-(--muted-foreground)">
          Units received beyond a PO or ASN line&apos;s open quantity pend here until a decision:
          approve applies the excess, reject leaves it unapplied — both audit-trailed. A PO or
          ASN cannot close while one of its over-receipts waits here.
        </div>
      </div>

      <div className="flex gap-1 text-xs" role="tablist" aria-label="Over-receipt status">
        {statusTabs.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={tab === s}
            onClick={() => setTab(s)}
            className={`rounded-sm border border-(--border) px-2 py-1 ${
              tab === s ? 'bg-(--muted) font-medium' : 'hover:bg-(--muted)'
            }`}
          >
            {TAB_LABEL[s]}
          </button>
        ))}
      </div>

      {queue !== null && queue.items.length === 0 ? (
        <div className="rounded-md border border-(--border) p-3 text-(--muted-foreground)">
          {tab === 'pending'
            ? 'No over-receipts waiting on a decision.'
            : `No ${tab} over-receipts.`}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {(queue?.items ?? []).map((entry) => (
            <OverReceiptCard
              key={entry.id}
              entry={entry}
              documentLabel={overReceiptDocumentLabel(entry, queue?.poCodes[entry.poId ?? ''] ?? null)}
              line={lineContext(entry, queue)}
              skuLabel={skus?.[entry.skuId]?.code ?? null}
              sku={skus?.[entry.skuId]}
              requestedBy={users?.[entry.requestedBy]?.email ?? null}
              canDecide={canDecide}
              deciding={decidingId === entry.id}
              onDecide={decide}
            />
          ))}
          {queue === null && <div className="p-3 text-(--muted-foreground)">Loading…</div>}
        </div>
      )}

      {queue !== null && queue.nextCursor !== null && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => queue.onCursor(queue.nextCursor)}
            className="rounded-sm border border-(--border) px-3 py-1 text-xs hover:bg-(--muted)"
          >
            Next
          </button>
        </div>
      )}

      {outcome !== null && (
        <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
      )}
    </section>
  );
}

/**
 * The document line's context: a PO line's ordered / received / open, or
 * (story 21-6) an ASN line's announced / received / open. Null while the
 * detail read has not resolved it.
 */
function lineContext(
  entry: OverReceiptDto,
  queue: { poLines: Readonly<Record<string, { orderedQty: number; receivedQty: number; openQty: number }>>; asnLines: Readonly<Record<string, { announcedQty: number; receivedQty: number; openQty: number }>> } | null,
): LineContext | null {
  if (queue === null) return null;
  if (entry.asnLineId !== undefined) {
    const line = queue.asnLines[entry.asnLineId];
    return line === undefined ? null : { expected: line.announcedQty, expectedWord: 'announced', receivedQty: line.receivedQty, openQty: line.openQty };
  }
  if (entry.poLineId === null) return null;
  const line = queue.poLines[entry.poLineId];
  return line === undefined ? null : { expected: line.orderedQty, expectedWord: 'ordered', receivedQty: line.receivedQty, openQty: line.openQty };
}

interface LineContext {
  readonly expected: number;
  readonly expectedWord: 'ordered' | 'announced';
  readonly receivedQty: number;
  readonly openQty: number;
}

function OverReceiptCard({
  entry,
  documentLabel,
  line,
  skuLabel,
  sku,
  requestedBy,
  canDecide,
  deciding,
  onDecide,
}: {
  entry: OverReceiptDto;
  documentLabel: string;
  line: LineContext | null;
  skuLabel: string | null;
  sku: SkuResponse | undefined;
  requestedBy: string | null;
  canDecide: boolean;
  deciding: boolean;
  onDecide: (entry: OverReceiptDto, decision: 'approve' | 'reject') => void;
}) {
  // The row's own SKU names the unit and its precision; an unresolvable SKU
  // keeps the shared unit-agnostic fallback rather than guessing a unit.
  const qty = (value: number) => quantityLabel(value, sku ?? null);
  return (
    <article className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-xs">{documentLabel}</span>
        <span className="font-mono text-xs">{skuLabel ?? '(unknown SKU)'}</span>
        <span className="font-medium">+{qty(entry.excessQty)} over open</span>
        <span className="font-mono text-xs text-(--muted-foreground)">{entry.grnCode}</span>
      </div>
      {line !== null && (
        <div className="text-xs text-(--muted-foreground)">
          Line: {qty(line.expected)} {line.expectedWord} · {qty(line.receivedQty)} received-to-date ·{' '}
          {openQtyLabel(line.openQty, sku)} open
        </div>
      )}
      <div className="text-xs text-(--muted-foreground)">
        Requested by {requestedBy ?? 'unknown user'} ·{' '}
        <time dateTime={entry.requestedAt}>{new Date(entry.requestedAt).toLocaleString()}</time>
        {entry.status !== 'pending' && (
          <>
            {' '}
            · {entry.status}
            {entry.decidedAt !== null && (
              <>
                {' '}
                <time dateTime={entry.decidedAt}>{new Date(entry.decidedAt).toLocaleString()}</time>
              </>
            )}
          </>
        )}
      </div>
      {entry.status === 'pending' && canDecide && (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={deciding}
            onClick={() => onDecide(entry, 'reject')}
            className="rounded-sm border border-(--border) px-3 py-1 text-xs hover:bg-(--muted) disabled:opacity-60"
          >
            Reject
          </button>
          <button
            type="button"
            disabled={deciding}
            onClick={() => onDecide(entry, 'approve')}
            className="rounded-sm bg-(--primary) px-3 py-1 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
          >
            Approve
          </button>
        </div>
      )}
    </article>
  );
}