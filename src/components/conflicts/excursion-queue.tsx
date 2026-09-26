'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import { ApiProblem, fetchApiResolveExcursion } from '@/lib/api/client';
import type { ExcursionDto, QcHoldDto } from '@/lib/api/generated';
import { readActiveWarehouseId, subscribeActiveWarehouse, writeActiveWarehouseId } from '@/lib/warehouses';
import { readSession, subscribeSession } from '@/lib/auth';
import { excursionResolveReason, holdLabel } from '@/lib/excursion';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { useBinCodeMap, useSkuMap, useUserMap } from '@/lib/use-inbound';
import { useExcursions } from '@/lib/use-excursions';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ReadFailure, selectClass } from '@/components/outbound/shell';

/**
 * The temperature-excursion review queue (story 12-5's read, surfaced by
 * story 12-7). An excursion is a floor-recorded out-of-range reading against
 * a bin; recording quarantined every affected (sku, bin) scope through
 * ordinary QC holds — the affected units here ARE those holds, joined to the
 * qc-holds read. Resolving is the review-status flip only: the created holds
 * are untouched, and stock disposition stays the qc.manage release /
 * stock.adjust verbs. Every resolve carries a fresh ULID Idempotency-Key so
 * a double click replays, never duplicates.
 *
 * The surface itself is nav-gated behind `review.decide` (the /conflicts
 * nav gate is unchanged), but the excursion list is open to any member — so
 * the queue renders read-only inside the component for non-`review.decide`
 * roles instead of a blocked screen (hide surfaces, never "blocked" screens
 * — the backend's per-command role read remains the authority).
 */

const statusTabs = ['open', 'resolved'] as const;
type StatusTab = (typeof statusTabs)[number];

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

const TAB_LABEL: Record<StatusTab, string> = {
  open: 'Open',
  resolved: 'Resolved',
};

export function ExcursionQueue() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Excursions</div>
        <div className="text-(--muted-foreground)">Sign in to review temperature excursions.</div>
      </div>
    );
  }
  return <ExcursionQueueSessioned />;
}

function ExcursionQueueSessioned() {
  const { tenantId, items: warehouses } = useTenantWarehouses() ?? { tenantId: null, items: [] };
  const activeId = useSyncExternalStore(
    subscribeActiveWarehouse,
    () => (tenantId === null ? null : readActiveWarehouseId(tenantId)),
    () => null,
  );
  // The warehouse being reviewed: the switcher's pick when it still belongs
  // to this tenant, else the first warehouse (the zone-bin-setup pattern —
  // the sidebar switcher can change warehouses without this state resetting).
  const warehouseId =
    activeId !== null && warehouses.some((w) => w.id === activeId)
      ? activeId
      : (warehouses[0]?.id ?? null);

  const [tab, setTab] = useState<StatusTab>('open');
  const queue = useExcursions(warehouseId, tab);
  const skus = useSkuMap();
  const users = useUserMap();
  const binCodes = useBinCodeMap(warehouseId);
  // Story 1.5 gating pattern: subscribed (not a bare readSession() at
  // render) so a /me bootstrap role rewrite re-renders the actions.
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canDecide = roleHasCapability(role, 'review.decide');

  const [outcome, setOutcome] = useState<Outcome>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  // A pre-render double-click fires both handlers before the disabled state
  // renders — this synchronous re-entry guard makes the second click a
  // no-op instead of a NEW command whose fresh Idempotency-Key would 409
  // right after the first resolve succeeded (the inbound-cards pattern,
  // checked in both arms).
  const resolveInFlight = useRef<Set<string>>(new Set());

  async function resolve(entry: ExcursionDto) {
    const session = readSession();
    if (session === null || resolveInFlight.current.has(entry.id)) return;
    resolveInFlight.current.add(entry.id);
    setResolvingId(entry.id);
    setOutcome(null);
    try {
      await fetchApiResolveExcursion(session.tenant.id, entry.id, ulid());
      setOutcome({
        tone: 'accepted',
        word: 'Excursion resolved',
        reason:
          'The review flip is audit-trailed. The quarantine holds are untouched — release or adjust them through the QC and stock verbs.',
      });
      queue?.reload();
    } catch (error) {
      // Clients branch on the machine-readable problem `code`: a 409
      // excursion-resolved means another reviewer moved first — the queue
      // re-reads (the reload IS the recovery the mapper's copy names).
      const alreadyResolved = error instanceof ApiProblem && error.code === 'excursion-resolved';
      setOutcome({ tone: 'rejected', word: 'Not resolved', reason: excursionResolveReason(error) });
      if (alreadyResolved) queue?.reload();
    } finally {
      resolveInFlight.current.delete(entry.id);
      setResolvingId(null);
    }
  }

  if (tenantId === null) return null;

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-medium">Excursions</h2>
          <div className="text-(--muted-foreground)">
            Out-of-range temperature readings recorded from the floor. Each open excursion&apos;s
            affected units are the QC holds recording created; resolve flips the review status —
            the holds themselves are released through QC.
          </div>
        </div>
        {warehouses.length > 0 && warehouseId !== null && (
          <label className="flex items-center gap-2 text-xs">
            <span className="text-(--muted-foreground)">Warehouse</span>
            <select
              className={`${selectClass} w-auto py-1`}
              value={warehouseId}
              onChange={(e) => writeActiveWarehouseId(tenantId, e.target.value)}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} {w.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex gap-1 text-xs" role="tablist" aria-label="Excursion status">
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

      {queue.state === 'failed' ? (
        <ReadFailure word="Excursion queue unavailable" reason={queue.reason} onRetry={queue.reload} />
      ) : queue.state === 'ready' && queue.data.items.length === 0 ? (
        <div className="rounded-md border border-(--border) p-3 text-(--muted-foreground)">
          {tab === 'open'
            ? 'No open excursions — nothing waiting on a review.'
            : 'No resolved excursions yet.'}
        </div>
      ) : queue.state === 'ready' ? (
        <div className="flex flex-col gap-2">
          {queue.data.items.map((entry) => (
            <ExcursionCard
              key={entry.id}
              entry={entry}
              binCode={binCodes?.[entry.binId] ?? null}
              skuLabel={(skuId) => skus?.[skuId]?.code ?? null}
              recordedBy={users?.[entry.recordedBy]?.email ?? null}
              resolvedBy={entry.resolvedBy === null ? null : (users?.[entry.resolvedBy]?.email ?? null)}
              holds={queue.data.holds}
              canDecide={canDecide}
              resolving={resolvingId === entry.id}
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
 * One excursion card — the over-receipt card's shape: the bin, the reading
 * as recorded (≤2 dp, never client-rounded), the note verbatim, the
 * affected units from the hold join, and the timestamps. A hold id the join
 * no longer returns labels disposed, never silently dropped.
 */
function ExcursionCard({
  entry,
  binCode,
  skuLabel,
  recordedBy,
  resolvedBy,
  holds,
  canDecide,
  resolving,
  onResolve,
}: {
  entry: ExcursionDto;
  binCode: string | null;
  skuLabel: (skuId: string) => string | null;
  recordedBy: string | null;
  resolvedBy: string | null;
  holds: { holds: Readonly<Record<string, QcHoldDto>>; truncated: boolean };
  canDecide: boolean;
  resolving: boolean;
  onResolve: (entry: ExcursionDto) => void;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{entry.readingC} °C</span>
        <span className="font-mono text-xs">{binCode ?? '(unknown bin)'}</span>
        <span className="font-mono text-xs text-(--muted-foreground)">
          <time dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString()}</time>
        </span>
        {entry.status !== 'open' && <span className="text-xs">resolved</span>}
      </div>
      {entry.note !== null && <div className="text-xs">{entry.note}</div>}
      {entry.holdIds.length > 0 && (
        <div className="text-xs text-(--muted-foreground)">
          Affected units:{' '}
          {entry.holdIds
            .map((holdId) => {
              const hold = holds.holds[holdId];
              const skuCode = hold === undefined ? null : skuLabel(hold.skuId);
              return `${skuCode ?? 'unknown SKU'} — ${holdLabel(hold)}`;
            })
            .join(' · ')}
          {holds.truncated && ' (the hold list may be incomplete)'}
        </div>
      )}
      <div className="text-xs text-(--muted-foreground)">
        Recorded by {recordedBy ?? 'unknown user'}
        {entry.status !== 'open' && (
          <>
            {' '}
            · resolved by {resolvedBy ?? 'unknown user'}
            {entry.resolvedAt !== null && (
              <>
                {' '}
                <time dateTime={entry.resolvedAt}>{new Date(entry.resolvedAt).toLocaleString()}</time>
              </>
            )}
          </>
        )}
      </div>
      {entry.status === 'open' && canDecide && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={resolving}
            onClick={() => onResolve(entry)}
            className="rounded-sm bg-(--primary) px-3 py-1 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
          >
            {resolving ? 'Resolving…' : 'Resolve'}
          </button>
        </div>
      )}
    </article>
  );
}