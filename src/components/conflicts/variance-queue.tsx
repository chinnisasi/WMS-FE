'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import { ApiProblem, fetchApiResolveVariance } from '@/lib/api/client';
import type { LedgerEventDto, SkuResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { quantityLabel } from '@/lib/format-quantity';
import { isOwnerOnlyVariance, resolveDraftProblem, varianceResolveReason } from '@/lib/review-queue';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { useSkuMap, useUserMap } from '@/lib/use-inbound';
import { binCodeLabel, useBinCodeMaps } from '@/lib/use-bin-code-maps';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';
import {
  useBinLedgerEvents,
  useVarianceQueue,
  type LedgerVarianceEntry,
  type VarianceStatus,
  VARIANCE_STATUSES,
} from '@/lib/use-variance-queue';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ReadFailure } from '@/components/outbound/shell';

/**
 * The escalated-variance review queue (story 5-5; the 5-4 spine's consumer).
 * A count that disagreed with its frozen expectation is open here until a
 * resolver settles it: approve-adjust — an explicit stock correction whose
 * audit states the ledger events consulted (the bin timeline the approver
 * pulled: non-empty, ≤ 200, each seq server-validated against THAT bin's
 * ledger, so client selection cannot fabricate history) — or a recount, the
 * stated remedy whenever the basis moved. Over-threshold variances are
 * flagged on the card, never hidden: an ops_manager sees the card and the
 * 403 names the owner-only gate (`variance-owner-required`).
 *
 * Every resolve carries a fresh ULID Idempotency-Key so a double click
 * replays, never duplicates; a 409 always ends in a queue reload, never a
 * stranded card.
 *
 * The list is a read, never capability-gated — the surface is nav-gated
 * behind `review.decide` (unchanged), and the tab's own gate hides the tab
 * from roles holding none of `variances.resolve`. Inside the component the
 * actions are gated again so a direct URL renders read-only instead of a
 * blocked screen; the backend's per-command role read remains the authority.
 */

const TAB_LABEL: Record<VarianceStatus, string> = {
  open: 'Open',
  adjusted: 'Adjusted',
  recounted: 'Recounted',
};

type ResolutionDecision = 'approve_adjust' | 'recount';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

export function VarianceQueue() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Variances</div>
        <div className="text-(--muted-foreground)">Sign in to review count variances.</div>
      </div>
    );
  }
  return <VarianceQueueSessioned />;
}

function VarianceQueueSessioned() {
  const [tab, setTab] = useState<VarianceStatus>('open');
  const queue = useVarianceQueue(tab);
  const skus = useSkuMap();
  const users = useUserMap();
  const { items: warehouses } = useTenantWarehouses() ?? { tenantId: null, items: [] };
  // The page's distinct warehouses drive the bin-code join (enrichment —
  // binLabels renders the honest "(unknown bin)" where a walk has not
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
  const canDecide = roleHasCapability(role, 'variances.resolve');

  // Per-entry in-flight state (a Set, in state — not a single slot): two
  // rows can be in flight at once, and one slot would re-enable card A's
  // buttons while its request is still outstanding just because card B
  // started moving.
  const [resolving, setResolving] = useState<ReadonlySet<string>>(new Set());
  // The outcome banner belongs to the entries it spoke about (keyed state,
  // not a reset effect — the house rule): a tab switch shows DIFFERENT
  // entries, and a stale "Correction applied" would invite the misread that
  // the newly displayed ones were just resolved.
  const [outcomeFor, setOutcomeFor] = useState<{
    tab: VarianceStatus;
    outcome: Exclude<Outcome, null>;
  } | null>(null);
  const outcome: Outcome = outcomeFor?.tab === tab ? outcomeFor.outcome : null;
  function showOutcome(next: Exclude<Outcome, null> | null) {
    setOutcomeFor(next === null ? null : { tab, outcome: next });
  }
  // A pre-render double-click fires both handlers before the disabled state
  // renders — this synchronous re-entry guard makes the second click a
  // no-op instead of a NEW command whose fresh Idempotency-Key would 409
  // right after the first resolve succeeded (the excursion-queue pattern,
  // checked in both arms).
  const resolveInFlight = useRef<Set<string>>(new Set());

  async function resolve(
    entry: LedgerVarianceEntry,
    decision: ResolutionDecision,
    consideredEventSeqs: readonly number[],
  ) {
    const session = readSession();
    if (session === null || resolveInFlight.current.has(entry.id)) return;
    // The approve arm's statement is refused client-side where the rule is
    // knowable without a server row: non-empty, within the 200 cap.
    const problem = resolveDraftProblem(decision, consideredEventSeqs);
    if (problem !== null) {
      showOutcome({ tone: 'rejected', word: 'Not resolved', reason: problem });
      return;
    }
    resolveInFlight.current.add(entry.id);
    setResolving((prev) => new Set(prev).add(entry.id));
    showOutcome(null);
    try {
      const resolved = await fetchApiResolveVariance(
        session.tenant.id,
        entry.id,
        decision === 'approve_adjust'
          ? {
              decision,
              // Deduped ascending server-side (`normalizeConsideredSeqs`);
              // sending it normalized keeps a reordered retry a real replay.
              consideredEventSeqs: [...new Set(consideredEventSeqs)].sort((a, b) => a - b),
            }
          : { decision },
        ulid(),
      );
      showOutcome({
        tone: 'accepted',
        word: resolved.variance.status === 'adjusted' ? 'Correction applied' : 'Recount opened',
        reason:
          resolved.variance.status === 'adjusted'
            ? 'One stock.adjusted event corrected the bin, audited with the consulted ledger seqs.'
            : 'A fresh count task is the corrected basis — this variance now reads as recounted history.',
      });
      queue.reload();
    } catch (error) {
      // Clients branch on the machine-readable problem `code`: a 409
      // variance-resolved means another reviewer moved first — the queue
      // re-reads (the reload IS the recovery the mapper's copy names). A
      // variance-basis-moved 409 names the recount arm, which is right on
      // the same card.
      const alreadyResolved = error instanceof ApiProblem && error.code === 'variance-resolved';
      showOutcome({
        tone: 'rejected',
        word: decision === 'approve_adjust' ? 'Not resolved' : 'No recount opened',
        reason: varianceResolveReason(error),
      });
      if (alreadyResolved) queue.reload();
    } finally {
      resolveInFlight.current.delete(entry.id);
      setResolving((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Variances</h2>
        <div className="text-(--muted-foreground)">
          Counts that disagreed with the bin&apos;s expectation at task start. Approve-adjust
          corrects the bin with one ledger event and the consulted seqs you check under the
          card; a recount opens a fresh count task as the corrected basis.
        </div>
      </div>

      <div className="flex gap-1 text-xs" role="tablist" aria-label="Variance status">
        {VARIANCE_STATUSES.map((s) => (
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
          word="Variance queue unavailable"
          reason={queue.reason}
          onRetry={queue.reload}
        />
      ) : queue.state === 'ready' && queue.data.items.length === 0 ? (
        <div className="rounded-md border border-(--border) p-3 text-(--muted-foreground)">
          {tab === 'open'
            ? 'No open variances — nothing waiting on a resolution.'
            : `No ${TAB_LABEL[tab].toLowerCase()} variances.`}
        </div>
      ) : queue.state === 'ready' ? (
        <div className="flex flex-col gap-2">
          {queue.data.items.map((entry) => (
            <VarianceCard
              key={entry.id}
              entry={entry}
              sku={skus?.[entry.skuId]}
              warehouseLabel={warehouses.find((w) => w.id === entry.warehouseId)?.code ?? null}
              binCode={binCodeLabel(binMaps, entry.warehouseId, entry.binId)}
              resolvedBy={
                entry.resolvedBy === null ? null : (users?.[entry.resolvedBy]?.email ?? null)
              }
              canDecide={canDecide}
              resolving={resolving.has(entry.id)}
              onResolve={resolve}
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

/**
 * One variance card. Quantities render at the row's own SKU's declared
 * precision; an unresolvable SKU keeps the unit-agnostic fallback. The
 * over-threshold and epochConflict badges are conditional chrome — visible
 * flags, never hiding rows (an ops_manager sees the owner-decision card and
 * the server's 403 names the gate).
 */
function VarianceCard({
  entry,
  sku,
  warehouseLabel,
  binCode,
  resolvedBy,
  canDecide,
  resolving,
  onResolve,
}: {
  entry: LedgerVarianceEntry;
  sku: SkuResponse | undefined;
  warehouseLabel: string | null;
  binCode: string | null;
  resolvedBy: string | null;
  canDecide: boolean;
  resolving: boolean;
  onResolve: (
    entry: LedgerVarianceEntry,
    decision: ResolutionDecision,
    consideredEventSeqs: readonly number[],
  ) => void;
}) {
  const qty = (value: number) => quantityLabel(value, sku ?? null);
  // The ledger panel mounts only when a card is expanded — the bin timeline
  // walk runs then, and its selection state dies with the card.
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const ownerOnly = isOwnerOnlyVariance(entry);
  const open = entry.status === 'open';

  return (
    <article className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-xs">{sku?.code ?? '(unknown SKU)'}</span>
        <span className="font-mono text-xs">
          {binCode ?? '(unknown bin)'}
          {warehouseLabel !== null && (
            <span className="text-(--muted-foreground)"> · {warehouseLabel}</span>
          )}
        </span>
        {entry.epochConflict && (
          <span className="rounded-sm border border-(--border) px-2 py-0.5 text-xs">
            bin moved while counting
          </span>
        )}
        {ownerOnly && (
          <span className="rounded-sm border border-(--border) px-2 py-0.5 text-xs">
            owner decision
          </span>
        )}
      </div>
      <div className="data flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
        <span>expected {qty(entry.expectedQuantity)}</span>
        <span>counted {qty(entry.countedQuantity)}</span>
        <span>
          delta{' '}
          {entry.delta < 0 ? `−${qty(Math.abs(entry.delta))}` : qty(entry.delta)}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-2 text-xs text-(--muted-foreground)">
        <span>
          {entry.thresholdQuantity === null
            ? 'No threshold policy was frozen at submit — every size resolves by manager.'
            : `Threshold ${qty(entry.thresholdQuantity)} frozen at submit.`}
        </span>
        <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
        {!open && (
          // The resolution's audit context: who, when, and the statement's
          // shape (the consulted seqs, or the minted recount task).
          <span>
            · resolved by {resolvedBy ?? 'unknown user'}
            {entry.resolvedAt !== null && (
              <>
                {' '}
                <time dateTime={entry.resolvedAt}>
                  {new Date(entry.resolvedAt).toLocaleString()}
                </time>
              </>
            )}
            {entry.status === 'adjusted' && entry.consideredEventSeqs !== null && (
              <> · consulted {entry.consideredEventSeqs.length} ledger seqs</>
            )}
            {entry.status === 'recounted' && entry.recountTaskId !== null && (
              <> · recount task {entry.recountTaskId.slice(0, 8)}…</>
            )}
          </span>
        )}
      </div>
      {open && canDecide && (
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => setLedgerOpen((v) => !v)}
            aria-expanded={ledgerOpen}
            className="rounded-sm border border-(--border) px-3 py-1 text-xs hover:bg-(--muted)"
          >
            {ledgerOpen ? 'Hide ledger' : 'Ledger'}
          </button>
          <button
            type="button"
            disabled={resolving}
            onClick={() => onResolve(entry, 'recount', [])}
            className="rounded-sm border border-(--border) px-3 py-1 text-xs hover:bg-(--muted) disabled:opacity-60"
          >
            {resolving ? 'Resolving…' : 'Open a recount'}
          </button>
        </div>
      )}
      {open && canDecide && ledgerOpen && (
        <VarianceLedgerPanel
          entry={entry}
          sku={sku ?? null}
          resolving={resolving}
          onResolve={onResolve}
        />
      )}
    </article>
  );
}

/**
 * The bin's ledger timeline for the approve-adjust statement: the events
 * touching this variance's bin (the binId filter matches source OR
 * destination, so other SKUs' events in the same bin appear and are
 * labelled with their own SKU's precision), each with its checkbox. The
 * resolution sends the seqs the approver ticked — the audit's answer to
 * "why is this number what it is".
 */
function VarianceLedgerPanel({
  entry,
  sku,
  resolving,
  onResolve,
}: {
  entry: LedgerVarianceEntry;
  sku: SkuResponse | null;
  resolving: boolean;
  onResolve: (
    entry: LedgerVarianceEntry,
    decision: ResolutionDecision,
    consideredEventSeqs: readonly number[],
  ) => void;
}) {
  const timeline = useBinLedgerEvents(entry.warehouseId, entry.binId);
  const users = useUserMap();
  const skus = useSkuMap();
  const [selected, setSelected] = useState<readonly number[]>([]);
  const qty = (value: number, event: LedgerEventDto) =>
    quantityLabel(value, event.skuId === entry.skuId ? sku : (skus?.[event.skuId] ?? null));

  const problem = resolveDraftProblem('approve_adjust', selected);

  function toggle(seq: number) {
    setSelected((prev) => (prev.includes(seq) ? prev.filter((s) => s !== seq) : [...prev, seq]));
  }

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-3">
      <div className="text-xs text-(--muted-foreground)">
        The bin&apos;s ledger history — tick every event you checked. The resolution records
        exactly these seqs.
      </div>
      {timeline.state === 'failed' ? (
        <ReadFailure
          word="Ledger timeline unavailable"
          reason={timeline.reason}
          onRetry={timeline.reload}
        />
      ) : timeline.state === 'ready' && timeline.data.items.length === 0 ? (
        <div className="p-2 text-xs text-(--muted-foreground)">
          No ledger events touch this bin — use the recount arm.
        </div>
      ) : timeline.state === 'ready' ? (
        <div className="flex flex-col gap-1">
          {timeline.data.items.map((event) => (
            <label key={event.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
              <input
                type="checkbox"
                checked={selected.includes(event.seq)}
                onChange={() => toggle(event.seq)}
              />
              <span className="font-mono">#{event.seq}</span>
              <span>{event.type}</span>
              <span className="data">
                {event.quantityDelta < 0
                  ? `−${qty(Math.abs(event.quantityDelta), event)}`
                  : `+${qty(event.quantityDelta, event)}`}
              </span>
              <span className="font-mono text-xs text-(--muted-foreground)">
                {users?.[event.actorUserId]?.email ?? 'unknown user'}
              </span>
              <span className="font-mono text-xs text-(--muted-foreground)">
                <time dateTime={event.occurredAt}>
                  {new Date(event.occurredAt).toLocaleString()}
                </time>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <div className="p-2 text-xs text-(--muted-foreground)">Loading…</div>
      )}
      {timeline.state === 'ready' && timeline.data.nextCursor !== null && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => timeline.onCursor(timeline.data.nextCursor)}
            className="rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted)"
          >
            Next
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-xs text-(--muted-foreground)">
          {selected.length === 0
            ? 'No events selected'
            : `${selected.length} event${selected.length === 1 ? '' : 's'} selected`}
        </span>
        <button
          type="button"
          disabled={resolving || problem !== null}
          onClick={() => onResolve(entry, 'approve_adjust', selected)}
          className="rounded-sm bg-(--primary) px-3 py-1 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
        >
          {resolving ? 'Resolving…' : 'Approve adjustment'}
        </button>
      </div>
      {problem !== null && <div className="text-xs text-(--destructive)">{problem}</div>}
    </div>
  );
}
