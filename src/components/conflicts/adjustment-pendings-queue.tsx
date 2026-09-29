'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import {
  ApiProblem,
  fetchApiApproveAdjustmentPending,
  fetchApiRejectAdjustmentPending,
} from '@/lib/api/client';
import type { AdjustmentPendingDto, SkuResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { quantityLabel } from '@/lib/format-quantity';
import { adjustmentDecisionReason } from '@/lib/review-queue';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { useSkuMap, useUserMap } from '@/lib/use-inbound';
import type { BinCodeMaps } from '@/lib/use-bin-code-maps';
import { useBinCodeMaps } from '@/lib/use-bin-code-maps';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';
import {
  useAdjustmentPendings,
  type AdjustmentPendingStatus,
  ADJUSTMENT_PENDING_STATUSES,
} from '@/lib/use-adjustment-pendings';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ReadFailure } from '@/components/outbound/shell';

/**
 * The adjustment-pendings queue (story 5-5; story 5-2's approval flow's
 * consumer). An adjustment whose |delta| strictly exceeded the tenant's
 * threshold at request time sits pending — ATP unchanged, no ledger event —
 * until a decision: Approve re-executes the stored arms through the full
 * guard set (a moved world answers the guard's 400/409/422 verbatim and the
 * row stays pending), Reject settles the pend with no stock write. The
 * threshold context is carried on each row, frozen at request.
 *
 * Every decision carries a fresh ULID Idempotency-Key so a double click
 * replays, never duplicates; a 409 `adjustment-pending-decided` always ends
 * in a queue reload, never a stranded card, and a 422
 * `idempotency-key-reuse` names the fresh-key re-click.
 *
 * The list is a read, never capability-gated — the surface is nav-gated
 * behind `review.decide` (unchanged), and the tab's own gate hides the tab
 * from roles holding none of `adjustments.approve`; the actions inside the
 * component are gated again so a direct URL renders read-only instead of a
 * blocked screen. No decision-note field and no requester-notification
 * here: both are backend changes and this FE-only story carries none of
 * them (the frozen 5-2 boundary).
 */

const TAB_LABEL: Record<AdjustmentPendingStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/** The list row the card renders — the DTO itself; the alias says what it is. */
type AdjustmentPendingView = AdjustmentPendingDto;

export function AdjustmentPendingsQueue() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Adjustment pendings</div>
        <div className="text-(--muted-foreground)">Sign in to review pending adjustments.</div>
      </div>
    );
  }
  return <AdjustmentPendingsQueueSessioned />;
}

function AdjustmentPendingsQueueSessioned() {
  const [tab, setTab] = useState<AdjustmentPendingStatus>('pending');
  const queue = useAdjustmentPendings(tab);
  const skus = useSkuMap();
  const users = useUserMap();
  const { items: warehouses } = useTenantWarehouses() ?? { tenantId: null, items: [] };
  // The page's distinct warehouses drive the bin-code join (enrichment —
  // binCodeOf renders the honest "(unknown bin)" where a walk has not
  // landed or failed).
  const items = queue.state === 'ready' ? queue.data.items : [];
  const warehouseIds = [...new Set(items.map((entry) => entry.warehouseId))];
  const binMaps = useBinCodeMaps(warehouseIds);
  // Story 1.5 gating pattern: subscribed (not a bare readSession() at
  // render) so a /me bootstrap role rewrite re-renders the actions.
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canApprove = roleHasCapability(role, 'adjustments.approve');

  const [decidingId, setDecidingId] = useState<string | null>(null);
  // The outcome banner belongs to the entries it spoke about (keyed state,
  // not a reset effect — the house rule): a tab switch shows DIFFERENT
  // entries, and a stale approval would invite the misread that the newly
  // displayed ones were just decided.
  const [outcomeFor, setOutcomeFor] = useState<{
    tab: AdjustmentPendingStatus;
    outcome: Exclude<Outcome, null>;
  } | null>(null);
  const outcome: Outcome = outcomeFor?.tab === tab ? outcomeFor.outcome : null;
  function showOutcome(next: Exclude<Outcome, null> | null) {
    setOutcomeFor(next === null ? null : { tab, outcome: next });
  }
  // A pre-render double-click fires both handlers before the disabled state
  // renders — the synchronous re-entry guard makes the second click a
  // no-op instead of a NEW command whose fresh Idempotency-Key would 409
  // right after the first decide succeeded (the excursion-queue pattern,
  // checked in both arms).
  const decideInFlight = useRef<Set<string>>(new Set());

  async function decide(entry: AdjustmentPendingView, decision: 'approve' | 'reject') {
    const session = readSession();
    if (session === null || decideInFlight.current.has(entry.id)) return;
    decideInFlight.current.add(entry.id);
    setDecidingId(entry.id);
    showOutcome(null);
    try {
      const decided =
        decision === 'approve'
          ? await fetchApiApproveAdjustmentPending(session.tenant.id, entry.id, ulid())
          : await fetchApiRejectAdjustmentPending(session.tenant.id, entry.id, ulid());
      showOutcome({
        tone: 'accepted',
        word: `${skus?.[entry.skuId]?.code ?? 'Pend'} ${decided.status}`,
        reason:
          decision === 'approve'
            ? 'The stored arms re-executed and the ledger carries the adjustment.'
            : 'The pend settled unapplied; the decision is audit-trailed.',
      });
      queue.reload();
    } catch (error) {
      // Clients branch on the machine-readable problem `code`: a 409
      // `adjustment-pending-decided` means another approver moved first —
      // the queue re-reads (the reload IS the recovery); a 422
      // `idempotency-key-reuse` names the fresh-key re-click. Guard-class
      // refusals from the approve arm's re-execution (a moved world) leave
      // the row pending and render the server's own words.
      const alreadyDecided =
        error instanceof ApiProblem && error.code === 'adjustment-pending-decided';
      showOutcome({
        tone: 'rejected',
        word: decision === 'approve' ? 'Not approved' : 'Not rejected',
        reason: adjustmentDecisionReason(error),
      });
      if (alreadyDecided) queue.reload();
    } finally {
      decideInFlight.current.delete(entry.id);
      setDecidingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Adjustment pendings</h2>
        <div className="text-(--muted-foreground)">
          Stock adjustments that exceeded the tenant&apos;s approval threshold at request time
          wait here — ATP unchanged while they pend. Approve re-executes the stored arms;
          reject settles them unapplied — both audit-trailed.
        </div>
      </div>

      <div className="flex gap-1 text-xs" role="tablist" aria-label="Adjustment pending status">
        {ADJUSTMENT_PENDING_STATUSES.map((s) => (
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

      {queue.state === 'failed' ? (
        <ReadFailure
          word="Adjustment-pending queue unavailable"
          reason={queue.reason}
          onRetry={queue.reload}
        />
      ) : queue.state === 'ready' && queue.data.items.length === 0 ? (
        <div className="rounded-md border border-(--border) p-3 text-(--muted-foreground)">
          {tab === 'pending'
            ? 'No pending adjustments — nothing waiting on a decision.'
            : `No ${TAB_LABEL[tab].toLowerCase()} adjustment pendings.`}
        </div>
      ) : queue.state === 'ready' ? (
        <div className="flex flex-col gap-2">
          {queue.data.items.map((entry) => (
            <AdjustmentPendingCard
              key={entry.id}
              entry={entry}
              sku={skus?.[entry.skuId]}
              warehouseLabel={warehouses.find((w) => w.id === entry.warehouseId)?.code ?? null}
              binCode={binCodeOf(binMaps, entry.warehouseId, entry.binId)}
              requestedBy={users?.[entry.requestedBy]?.email ?? null}
              decidedBy={
                entry.decidedBy === null ? null : (users?.[entry.decidedBy]?.email ?? null)
              }
              canApprove={canApprove}
              deciding={decidingId === entry.id}
              onDecide={decide}
            />
          ))}
        </div>
      ) : (
        <div className="p-3 text-(--muted-foreground)">Loading…</div>
      )}

      {queue.state === 'ready' && queue.data.nextCursor !== null && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => queue.onCursor(queue.data.nextCursor)}
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

/** The bin-code join's card label; a bin the walk has not landed renders unknown. */
function binCodeOf(
  maps: BinCodeMaps | null,
  warehouseId: string,
  binId: string,
): string | null {
  if (maps === null) return null;
  const map = maps[warehouseId];
  if (map === undefined) return null;
  return map[binId] ?? null;
}

/**
 * One pending-adjustment card — the 5-2 approval card: the signed delta at
 * the row's SKU's precision, the reason code, the requester's note verbatim,
 * the threshold context inline (frozen at request), and the serial /
 * handling-unit / batch-override arms stated, never silently dropped.
 */
function AdjustmentPendingCard({
  entry,
  sku,
  warehouseLabel,
  binCode,
  requestedBy,
  decidedBy,
  canApprove,
  deciding,
  onDecide,
}: {
  entry: AdjustmentPendingView;
  sku: SkuResponse | undefined;
  warehouseLabel: string | null;
  binCode: string | null;
  requestedBy: string | null;
  decidedBy: string | null;
  canApprove: boolean;
  deciding: boolean;
  onDecide: (entry: AdjustmentPendingView, decision: 'approve' | 'reject') => void;
}) {
  const qty = (value: number) => quantityLabel(value, sku ?? null);
  const pending = entry.status === 'pending';
  const delta =
    entry.quantityDelta < 0 ? `−${qty(Math.abs(entry.quantityDelta))}` : `+${qty(entry.quantityDelta)}`;

  return (
    <article className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{delta}</span>
        <span className="font-mono text-xs">{sku?.code ?? '(unknown SKU)'}</span>
        <span className="font-mono text-xs">
          {binCode ?? '(unknown bin)'}
          {warehouseLabel !== null && (
            <span className="text-(--muted-foreground)"> · {warehouseLabel}</span>
          )}
        </span>
        <span className="rounded-sm border border-(--border) px-2 py-0.5 text-xs">
          {entry.reasonCode}
        </span>
      </div>
      {entry.note !== '' && <div className="text-xs">{entry.note}</div>}
      {entry.batchOverrideReason !== null && (
        <div className="text-xs text-(--muted-foreground)">
          FEFO override: {entry.batchOverrideReason}
        </div>
      )}
      {(entry.serialIds !== null || entry.handlingUnitIds !== null) && (
        <div className="text-xs text-(--muted-foreground)">
          {entry.serialIds !== null &&
            `Serial-tracked (${entry.serialIds.length} serial${entry.serialIds.length === 1 ? '' : 's'})`}
          {entry.serialIds !== null && entry.handlingUnitIds !== null && ' · '}
          {entry.handlingUnitIds !== null &&
            `Catch-weight (${entry.handlingUnitIds.length} handling unit${entry.handlingUnitIds.length === 1 ? '' : 's'})`}
        </div>
      )}
      <div className="text-xs text-(--muted-foreground)">
        Requested by {requestedBy ?? 'unknown user'} ·{' '}
        <time dateTime={entry.requestedAt}>{new Date(entry.requestedAt).toLocaleString()}</time>
        {' '}· threshold {qty(entry.thresholdQuantityAtRequest)} frozen at request
        {entry.status !== 'pending' && (
          <>
            {' '}· {entry.status} by {decidedBy ?? 'unknown user'}
            {entry.decidedAt !== null && (
              <>
                {' '}
                <time dateTime={entry.decidedAt}>
                  {new Date(entry.decidedAt).toLocaleString()}
                </time>
              </>
            )}
          </>
        )}
      </div>
      {pending && canApprove && (
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
            {deciding ? 'Deciding…' : 'Approve'}
          </button>
        </div>
      )}
    </article>
  );
}