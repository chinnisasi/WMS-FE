'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import { ApiProblem, fetchApiResolveRejectedOp } from '@/lib/api/client';
import { readSession, subscribeSession } from '@/lib/auth';
import { rejectedOpPayloadBinId, rejectedOpsResolveReason } from '@/lib/review-queue';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { useUserMap } from '@/lib/use-inbound';
import { binCodeLabel, useBinCodeMaps } from '@/lib/use-bin-code-maps';
import { useRejectedOps } from '@/lib/use-rejected-ops';
import { useBinLedgerEvents } from '@/lib/use-variance-queue';
import type { RejectedOpEntry, RejectedOpStatus } from '@/lib/use-rejected-ops';
import { REJECTED_OP_STATUSES } from '@/lib/use-rejected-ops';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ReadFailure } from '@/components/outbound/shell';

/**
 * The rejected-ops review queue (story 5-6, the AD-14 spine's web arm). The
 * terminal ops a device's replay ended on without landing — refused outright
 * (`rejected`) or held as an AD-14 case-4 `quarantined` resident — arrive
 * through the device sync report's AUDIT-ONLY record, and open here until a
 * resolver settles them. Three arms, each carrying a fresh ULID so a double
 * click replays, never duplicates:
 *   - `apply` re-executes the op against every live guard — NEVER a
 *     force-write (binStateEpoch is stripped; the sync report's snapshot
 *     truth stays the device's own). A refusal (device revoked, the bin
 *     moved, the epoch moved) surfaces the server's own words verbatim and
 *     the row stays open.
 *   - `recount` re-plans the bin the payload names; the server backs the
 *     rule with a 400, the client never sends it without one.
 *   - `discard` retires the row with a marker — the refusal's history.
 * The list is a read, never capability-gated — the surface is nav-gated
 * behind `review.decide` (unchanged), and the tab's own gate hides the tab
 * from roles holding none (owner, ops_manager). Inside the component the
 * actions are gated again so a direct URL renders read-only; the backend's
 * per-command role read remains the authority. A 409 `rejected-op-resolved`
 * always ends in a queue reload, never a stranded card.
 */

const TAB_LABEL: Record<RejectedOpStatus, string> = {
  open: 'Open',
  applied: 'Applied',
  recounted: 'Recounted',
  discarded: 'Discarded',
};

type ResolutionDecision = 'apply' | 'recount' | 'discard';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/** A string payload/attr field, honest about its absence. */
function fieldText(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function RejectedOpsQueue() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Rejected ops</div>
        <div className="text-(--muted-foreground)">Sign in to review rejected device ops.</div>
      </div>
    );
  }
  return <RejectedOpsQueueSessioned />;
}

function RejectedOpsQueueSessioned() {
  const [tab, setTab] = useState<RejectedOpStatus>('open');
  const queue = useRejectedOps(tab);
  const users = useUserMap();
  // The page's bin-carrying payloads drive the bin-code join (enrichment —
  // the card renders the honest "(unknown bin)" where the walk has not
  // landed or the payload does not name a bin).
  const items = queue.state === 'ready' ? queue.data.items : [];
  const warehouseIds = [
    ...new Set(items.map((entry) => fieldText(entry.payload, 'warehouseId')).filter((w) => w !== null)),
  ];
  const binMaps = useBinCodeMaps(warehouseIds);
  // Story 1.5 gating pattern: subscribed (not a bare readSession() at
  // render) so a /me bootstrap role rewrite re-renders the actions.
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canDecide = roleHasCapability(role, 'review.decide');

  // Per-entry in-flight state (a Set, in state — not a single slot): two
  // rows can be in flight at once, and one slot would re-enable card A's
  // buttons while its request is still outstanding just because card B
  // started moving.
  const [resolving, setResolving] = useState<ReadonlySet<string>>(new Set());
  // The outcome banner belongs to the entries it spoke about (keyed state,
  // not a reset effect — the house rule): a tab switch shows DIFFERENT
  // entries, and a stale "Op applied" would invite the misread that the
  // newly displayed ones were just resolved.
  const [outcomeFor, setOutcomeFor] = useState<{
    tab: RejectedOpStatus;
    outcome: Exclude<Outcome, null>;
  } | null>(null);
  const outcome: Outcome = outcomeFor?.tab === tab ? outcomeFor.outcome : null;
  function showOutcome(next: Exclude<Outcome, null> | null) {
    setOutcomeFor(next === null ? null : { tab, outcome: next });
  }
  // A pre-render double-click fires both handlers before the disabled state
  // renders — this synchronous re-entry guard makes the second click a
  // no-op instead of a NEW command whose fresh Idempotency-Key would 409
  // right after the first resolve succeeded (the variance-queue pattern,
  // checked in both arms).
  const resolveInFlight = useRef<Set<string>>(new Set());

  async function resolve(entry: RejectedOpEntry, decision: ResolutionDecision) {
    const session = readSession();
    if (session === null || resolveInFlight.current.has(entry.id)) return;
    // The recount arm's payload-bin rule is knowable without a server row:
    // a payload that names no bin is refused client-side (the server's 400
    // stays a backstop, never the UI's plan). The helper reads `binId ??
    // toBinId` — the server's own recount read, see Entry D.
    const binId = rejectedOpPayloadBinId(entry.payload);
    if (decision === 'recount' && binId === null) return;
    resolveInFlight.current.add(entry.id);
    setResolving((prev) => new Set(prev).add(entry.id));
    showOutcome(null);
    try {
      const resolved = await fetchApiResolveRejectedOp(session.tenant.id, entry.id, { decision }, ulid());
      const status = resolved.rejectedOp.status;
      showOutcome({
        tone: 'accepted',
        word:
          status === 'applied' ? 'Op applied' : status === 'recounted' ? 'Recount opened' : 'Discarded',
        reason:
          status === 'applied'
            ? 'The op re-executed against the live guards and landed — the same ledger truth every other path writes.'
            : status === 'recounted'
              ? 'A fresh count task is the corrected basis — the bin’s history, not a force-write, answers the op.'
              : 'The op is retired with a discard marker — its refusal stays readable in the row.',
      });
      queue.reload();
    } catch (error) {
      // A 409 `rejected-op-resolved` means another reviewer moved first —
      // the queue re-reads (the reload IS the recovery the mapper's copy
      // names). The apply/recount guards' own refusals (403/409) surface
      // verbatim and the row stays open — nothing to reload.
      const alreadyResolved = error instanceof ApiProblem && error.code === 'rejected-op-resolved';
      showOutcome({
        tone: 'rejected',
        word: decision === 'apply' ? 'Not applied' : decision === 'recount' ? 'No recount opened' : 'Not discarded',
        reason: rejectedOpsResolveReason(error),
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
        <h2 className="font-medium">Rejected ops</h2>
        <div className="text-(--muted-foreground)">
          Terminal ops a device&apos;s replay ended on without landing — refused outright, or held
          as an AD-14 quarantine resident and uploaded by its sync report. Apply re-executes the
          op under every live guard; a recount re-plans the bin; a discard retires the record.
        </div>
      </div>

      <div className="flex gap-1 text-xs" role="tablist" aria-label="Rejected op status">
        {REJECTED_OP_STATUSES.map((s) => (
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
          word="Rejected-ops queue unavailable"
          reason={queue.reason}
          onRetry={queue.reload}
        />
      ) : queue.state === 'ready' && queue.data.items.length === 0 ? (
        <div className="rounded-md border border-(--border) p-3 text-(--muted-foreground)">
          {tab === 'open'
            ? 'No open rejected ops — every dropped op the devices reported is settled.'
            : `No ${TAB_LABEL[tab].toLowerCase()} rejected ops.`}
        </div>
      ) : queue.state === 'ready' ? (
        <div className="flex flex-col gap-2">
          {queue.data.items.map((entry) => (
            <RejectedOpCard
              key={entry.id}
              entry={entry}
              binCode={binLabelFor(entry, binMaps)}
              resolvedBy={entry.resolvedBy === null ? null : (users?.[entry.resolvedBy]?.email ?? null)}
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

/** The payload's bin label when both ids are present; null keeps the card's "(unknown bin)". */
function binLabelFor(entry: RejectedOpEntry, binMaps: ReturnType<typeof useBinCodeMaps>) {
  const warehouseId = fieldText(entry.payload, 'warehouseId');
  const binId = rejectedOpPayloadBinId(entry.payload);
  if (warehouseId === null || binId === null) return null;
  return binCodeLabel(binMaps, warehouseId, binId);
}

/**
 * One rejected-op card. The refusal is pinned verbatim (the server's
 * problem code, plus its detail when it carried one) — this queue's whole
 * point is showing the device's replay exactly as it ended. Classification
 * is a badge, never a hiding filter.
 */
function RejectedOpCard({
  entry,
  binCode,
  resolvedBy,
  canDecide,
  resolving,
  onResolve,
}: {
  entry: RejectedOpEntry;
  binCode: string | null;
  resolvedBy: string | null;
  canDecide: boolean;
  resolving: boolean;
  onResolve: (entry: RejectedOpEntry, decision: ResolutionDecision) => void;
}) {
  // The expanded panel mounts the payload list — and the ledger walk when
  // the payload names a bin; its selection state dies with the card.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const payloadBinId = rejectedOpPayloadBinId(entry.payload);
  const deviceLabel = fieldText(entry.attribution, 'deviceLabel');
  const operatorEmail = fieldText(entry.attribution, 'operatorEmail');
  const open = entry.status === 'open';

  return (
    <article className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-xs">{entry.opType}</span>
        <span className="font-mono text-xs">
          {binCode ?? '(unknown bin)'}
        </span>
        <span className="rounded-sm border border-(--border) px-2 py-0.5 text-xs">
          {entry.classification === 'quarantined' ? 'quarantined · AD-14' : 'refused'}
        </span>
      </div>
      <div className="text-xs">
        <span className="font-mono">{entry.problemCode}</span>
        {entry.problemDetail !== null && <span> — {entry.problemDetail}</span>}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-(--muted-foreground)">
        <span>device {deviceLabel ?? 'unknown device'}</span>
        <span>operator {operatorEmail ?? 'unknown operator'}</span>
        <span>
          enqueued <time dateTime={entry.opEnqueuedAt}>{new Date(entry.opEnqueuedAt).toLocaleString()}</time>
        </span>
        {entry.opOccurredAt !== null && (
          <span>
            occurred{' '}
            <time dateTime={entry.opOccurredAt}>{new Date(entry.opOccurredAt).toLocaleString()}</time>
          </span>
        )}
        {!open && (
          // The resolution's audit context: who, when, and the arm's shape.
          <span>
            · resolved by {resolvedBy ?? 'unknown user'}
            {entry.resolvedAt !== null && (
              <>{' '}
                <time dateTime={entry.resolvedAt}>{new Date(entry.resolvedAt).toLocaleString()}</time>
              </>
            )}
            {entry.status === 'recounted' &&
              entry.resolvedOutcome !== null &&
              typeof entry.resolvedOutcome['countTaskId'] === 'string' && (
                <> · recount task {(entry.resolvedOutcome['countTaskId'] as string).slice(0, 8)}…</>
              )}
            {entry.status === 'applied' && entry.resolvedOutcome !== null && <> · re-executed, snapshot recorded</>}
            {entry.status === 'discarded' && <> · retire marker recorded</>}
          </span>
        )}
      </div>
      {canDecide && (
        <div className="flex flex-wrap justify-end gap-2">
          {/* The Details affordance reads the row regardless of its status —
              a resolver who settled a row can still open the payload (Entry
              O: settled rows cannot be re-inspected otherwise). Only the
              DECISION arms are open-gated: a settled row has none left. */}
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
            className="rounded-sm border border-(--border) px-3 py-1 text-xs hover:bg-(--muted)"
          >
            {detailsOpen ? 'Hide details' : 'Details'}
          </button>
          {open && (
            <>
              <button
                type="button"
                disabled={resolving}
                onClick={() => onResolve(entry, 'discard')}
                className="rounded-sm border border-(--border) px-3 py-1 text-xs hover:bg-(--muted) disabled:opacity-60"
              >
                {resolving ? 'Resolving…' : 'Discard'}
              </button>
              {payloadBinId !== null && (
                <button
                  type="button"
                  disabled={resolving}
                  onClick={() => onResolve(entry, 'recount')}
                  className="rounded-sm border border-(--border) px-3 py-1 text-xs hover:bg-(--muted) disabled:opacity-60"
                >
                  {resolving ? 'Resolving…' : 'Open a recount'}
                </button>
              )}
              <button
                type="button"
                disabled={resolving}
                onClick={() => onResolve(entry, 'apply')}
                className="rounded-sm bg-(--primary) px-3 py-1 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
              >
                {resolving ? 'Resolving…' : 'Apply (re-execute)'}
              </button>
            </>
          )}
        </div>
      )}
      {detailsOpen && <RejectedOpDetails entry={entry} />}
    </article>
  );
}

/**
 * The expanded panel: the op's payload as enqueued (the apply arm re-executes
 * exactly this, base units) and, when the payload names a bin, the bin's
 * ledger timeline — read-only context for the decision, never a statement
 * (unlike the variance queue's consulted-seqs, this resolution records no
 * selection). When the payload carries no bin there is no timeline: an
 * audit-only op (an excursion) has no bin history to walk.
 */
function RejectedOpDetails({ entry }: { entry: RejectedOpEntry }) {
  const warehouseId = fieldText(entry.payload, 'warehouseId');
  // The ledger walk targets THE bin the recount arm would re-plan — for a
  // placement payload that is `toBinId` (the same probe the recount arm and
  // the server read), never a `binId` the placement does not carry.
  const binId = rejectedOpPayloadBinId(entry.payload);
  const payloadKeys = Object.keys(entry.payload);
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-3">
      <div className="text-xs text-(--muted-foreground)">
        The op&apos;s payload as the device enqueued it — the apply arm re-executes exactly this.
      </div>
      {payloadKeys.length === 0 ? (
        <div className="p-2 text-xs text-(--muted-foreground)">The payload is empty.</div>
      ) : (
        <div className="flex flex-col gap-0.5 font-mono text-xs">
          {payloadKeys.map((key) => (
            <div key={key} className="flex flex-wrap gap-x-2">
              <span>{key}</span>
              <span className="text-(--muted-foreground)">{JSON.stringify(entry.payload[key])}</span>
            </div>
          ))}
        </div>
      )}
      {warehouseId !== null && binId !== null && <RejectedOpLedger warehouseId={warehouseId} binId={binId} />}
    </div>
  );
}

function RejectedOpLedger({ warehouseId, binId }: { warehouseId: string; binId: string }) {
  const timeline = useBinLedgerEvents(warehouseId, binId);
  const users = useUserMap();
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-(--muted-foreground)">
        The bin&apos;s ledger history since the op&apos;s attempt — what a recount would re-examine.
      </div>
      {timeline.state === 'failed' ? (
        <ReadFailure word="Ledger timeline unavailable" reason={timeline.reason} onRetry={timeline.reload} />
      ) : timeline.state === 'ready' && timeline.data.items.length === 0 ? (
        <div className="p-2 text-xs text-(--muted-foreground)">
          No ledger events touch this bin.
        </div>
      ) : timeline.state === 'ready' ? (
        <div className="flex flex-col gap-1">
          {timeline.data.items.map((event) => (
            <div key={event.id} className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              <span className="font-mono">#{event.seq}</span>
              <span>{event.type}</span>
              <span className="data">{event.quantityDelta < 0 ? `−${Math.abs(event.quantityDelta)}` : `+${event.quantityDelta}`}</span>
              <span className="font-mono text-xs text-(--muted-foreground)">
                {users?.[event.actorUserId]?.email ?? 'unknown user'}
              </span>
              <span className="font-mono text-xs text-(--muted-foreground)">
                <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
              </span>
            </div>
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
    </div>
  );
}
